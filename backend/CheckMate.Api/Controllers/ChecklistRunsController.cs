using CheckMate.Api.Contracts;
using CheckMate.Api.Data;
using CheckMate.Api.Models;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace CheckMate.Api.Controllers;

/// <remarks>
/// Log statements use structured logging with typed route parameters (e.g. int runId) only.
/// User-provided strings such as step text are intentionally excluded to prevent log-forging.
/// </remarks>
[ApiController]
[Route("api/runs")]
public class ChecklistRunsController(ChecklistDbContext dbContext, ILogger<ChecklistRunsController> logger) : ControllerBase
{
    private const string CompletedRunMessage = "This run is complete and can't be changed.";

    private const string NumberLimitsMessage =
        "The number must have at most 9 digits before the decimal point and 6 after it.";

    private const decimal MaxResponseNumber = 1_000_000_000m;

    private const string OptionNotOnStepMessage = "The option must be one of this step's options.";

    private const string LockedStepMessage = "This step can't be filled in until the steps it depends on are done.";

    private const string UnfinishedStepsMessage = "Every step must be done before the run can be completed.";

    private const string ClientKeyRequiredMessage = "A client key is required.";

    private const string DuplicateStepsMessage = "Each step can only be sent once.";

    private const string OtherChecklistMessage = "This fill-out belongs to another checklist.";

    private const string SyncedElsewhereMessage = "This fill-out was synced by another request. Try again.";

    [HttpPost("~/api/checklists/{checklistId:int}/runs")]
    public async Task<ActionResult<ChecklistRunResponse>> Start(int checklistId)
    {
        var checklist = await dbContext.Checklists
            .AsNoTracking()
            .FirstOrDefaultAsync(item => item.Id == checklistId);

        if (checklist is null)
        {
            logger.LogWarning("Checklist {ChecklistId} not found for starting a run", checklistId);
            return NotFound();
        }

        var steps = await dbContext.ChecklistSteps
            .AsNoTracking()
            .Where(step => step.ChecklistId == checklistId)
            .OrderBy(step => step.SortOrder)
            .ThenBy(step => step.Id)
            .ToListAsync();

        // Copy each step's text, type and position into the run, so later edits to the checklist don't change it.
        var run = new ChecklistRun
        {
            ClientKey = Guid.NewGuid(),
            ChecklistId = checklistId,
            StartedAt = DateTimeOffset.UtcNow,
            Steps = [.. steps.Select((step, index) => new ChecklistRunStep
            {
                StepId = step.Id,
                StepText = step.Text,
                StepType = step.Type,
                SortOrder = index
            })]
        };

        dbContext.ChecklistRuns.Add(run);
        await dbContext.SaveChangesAsync();

        logger.LogInformation("Started run {RunId} of checklist {ChecklistId}", run.Id, checklistId);

        return CreatedAtAction(nameof(GetById), new { runId = run.Id }, await ToResponseAsync(run, checklist.Name));
    }

    [HttpGet("~/api/checklists/{checklistId:int}/runs")]
    public async Task<ActionResult<IEnumerable<ChecklistRunSummaryResponse>>> GetForChecklist(int checklistId)
    {
        logger.LogInformation("Retrieving runs of checklist {ChecklistId}", checklistId);

        if (!await dbContext.Checklists.AnyAsync(item => item.Id == checklistId))
        {
            logger.LogWarning("Checklist {ChecklistId} not found for listing runs", checklistId);
            return NotFound();
        }

        var runs = await dbContext.ChecklistRuns
            .AsNoTracking()
            .Where(run => run.ChecklistId == checklistId)
            .OrderByDescending(run => run.StartedAt)
            .ThenByDescending(run => run.Id)
            .Select(run => new ChecklistRunSummaryResponse(run.Id, run.ClientKey, run.StartedAt, run.CompletedAt))
            .ToListAsync();

        logger.LogInformation("Retrieved {Count} runs of checklist {ChecklistId}", runs.Count, checklistId);

        return Ok(runs);
    }

    [HttpGet("{runId:int}")]
    public async Task<ActionResult<ChecklistRunResponse>> GetById(int runId)
    {
        logger.LogInformation("Retrieving run {RunId}", runId);

        var run = await dbContext.ChecklistRuns
            .AsNoTracking()
            .Include(item => item.Steps)
            .FirstOrDefaultAsync(item => item.Id == runId);

        if (run is null)
        {
            logger.LogWarning("Run {RunId} not found", runId);
            return NotFound();
        }

        return Ok(await ToResponseAsync(run, await GetChecklistNameAsync(run.ChecklistId)));
    }

    // A device only knows the key it gave a run until the run has been synced, so it can open the run by that.
    [HttpGet("{clientKey:guid}")]
    public async Task<ActionResult<ChecklistRunResponse>> GetByKey(Guid clientKey)
    {
        logger.LogInformation("Retrieving run with client key {ClientKey}", clientKey);

        var run = await dbContext.ChecklistRuns
            .AsNoTracking()
            .Include(item => item.Steps)
            .FirstOrDefaultAsync(item => item.ClientKey == clientKey);

        if (run is null)
        {
            logger.LogWarning("Run with client key {ClientKey} not found", clientKey);
            return NotFound();
        }

        return Ok(await ToResponseAsync(run, await GetChecklistNameAsync(run.ChecklistId)));
    }

    [HttpPut("{runId:int}/steps/{stepId:int}")]
    public async Task<ActionResult<ChecklistRunStepResponse>> UpdateStep(int runId, int stepId, [FromBody] RunStepRequest request)
    {
        var run = await dbContext.ChecklistRuns.FirstOrDefaultAsync(item => item.Id == runId);

        if (run is null)
        {
            logger.LogWarning("Run {RunId} not found for step update", runId);
            return NotFound();
        }

        // All of the run's steps, since whether this one can change depends on the steps it's linked to.
        var runSteps = await dbContext.ChecklistRunSteps
            .Where(item => item.RunId == runId)
            .ToListAsync();
        var runStep = runSteps.FirstOrDefault(item => item.StepId == stepId);

        if (runStep is null)
        {
            logger.LogWarning("Step {StepId} not found in run {RunId}", stepId, runId);
            return NotFound();
        }

        if (run.CompletedAt is not null)
        {
            logger.LogWarning("Rejected step update for completed run {RunId}", runId);
            return Conflict(new { message = CompletedRunMessage });
        }

        var dependsOn = await GetDependsOnAsync(runSteps);

        if (IsLocked(runStep, runSteps, dependsOn))
        {
            logger.LogWarning("Rejected update of locked step {StepId} in run {RunId}", stepId, runId);
            ModelState.AddModelError(string.Empty, LockedStepMessage);
            return ValidationProblem(ModelState);
        }

        // A value that isn't a number at all is already rejected when the request is read.
        if (runStep.StepType == StepType.Number && request.Number is decimal number && !FitsResponseNumber(number))
        {
            logger.LogWarning("Rejected number for step {StepId} in run {RunId} that doesn't fit", stepId, runId);
            ModelState.AddModelError(nameof(request.Number), NumberLimitsMessage);
            return ValidationProblem(ModelState);
        }

        StepOption? selectedOption = null;

        if (runStep.StepType == StepType.Choice && request.OptionId is int optionId)
        {
            selectedOption = await dbContext.StepOptions
                .AsNoTracking()
                .FirstOrDefaultAsync(option => option.Id == optionId && option.StepId == stepId);

            if (selectedOption is null)
            {
                logger.LogWarning("Rejected option for step {StepId} in run {RunId} that isn't one of its options", stepId, runId);
                ModelState.AddModelError(nameof(request.OptionId), OptionNotOnStepMessage);
                return ValidationProblem(ModelState);
            }
        }

        var wasDone = runStep.IsDone;

        ApplyResponse(
            runStep,
            request.IsDone,
            request.Text,
            request.Number,
            selectedOption is null ? null : (selectedOption.Id, selectedOption.Text),
            DateTimeOffset.UtcNow);

        // A done step that depends on this one would then have a prerequisite that isn't done, so it's un-done first.
        if (wasDone && !runStep.IsDone)
        {
            var doneDependents = runSteps
                .Where(item => item.IsDone && item.StepId is int id && dependsOn[id].Contains(stepId))
                .OrderBy(item => item.SortOrder)
                .Select(item => $"\"{item.StepText}\"")
                .ToList();

            if (doneDependents.Count > 0)
            {
                logger.LogWarning("Rejected un-doing step {StepId} in run {RunId} while steps that depend on it are done", stepId, runId);
                ModelState.AddModelError(
                    string.Empty,
                    $"Un-do {string.Join(", ", doneDependents)} first, since {(doneDependents.Count == 1 ? "it depends" : "they depend")} on this step.");
                return ValidationProblem(ModelState);
            }
        }

        // Write the run's CompletedAt back unchanged, so the save checks the run is still open in the same
        // transaction (see IsConcurrencyToken in ChecklistDbContext) and can't change a run completed since it was read.
        dbContext.Entry(run).Property(item => item.CompletedAt).IsModified = true;

        try
        {
            await dbContext.SaveChangesAsync();
        }
        catch (DbUpdateConcurrencyException)
        {
            if (!await RunExistsAsync(runId))
            {
                logger.LogWarning("Run {RunId} deleted while saving step {StepId}", runId, stepId);
                return NotFound();
            }

            logger.LogWarning("Rejected step update for run {RunId} completed while saving", runId);
            return Conflict(new { message = CompletedRunMessage });
        }
        catch (DbUpdateException) when (selectedOption is not null)
        {
            // The option was removed from the step after it was checked above, so its foreign key failed the save.
            if (await dbContext.StepOptions.AsNoTracking().AnyAsync(option => option.Id == selectedOption.Id))
            {
                throw;
            }

            logger.LogWarning("Rejected option for step {StepId} in run {RunId} removed while saving", stepId, runId);
            ModelState.AddModelError(nameof(request.OptionId), OptionNotOnStepMessage);
            return ValidationProblem(ModelState);
        }

        logger.LogInformation("Saved step {StepId} in run {RunId}", stepId, runId);

        var options = await GetOptionsAsync([runStep]);

        return Ok(ChecklistRunStepResponse.From(runStep, options[stepId], dependsOn[stepId], false));
    }

    [HttpPost("{runId:int}/complete")]
    public async Task<ActionResult<ChecklistRunResponse>> Complete(int runId)
    {
        var run = await dbContext.ChecklistRuns
            .Include(item => item.Steps)
            .FirstOrDefaultAsync(item => item.Id == runId);

        if (run is null)
        {
            logger.LogWarning("Run {RunId} not found for completion", runId);
            return NotFound();
        }

        if (run.CompletedAt is not null)
        {
            logger.LogWarning("Rejected completion of already completed run {RunId}", runId);
            return Conflict(new { message = CompletedRunMessage });
        }

        // A step deleted from the checklist can't be filled in any more, so it doesn't hold the run back.
        if (run.Steps.Any(step => !step.IsDone && step.StepId is not null))
        {
            logger.LogWarning("Rejected completion of run {RunId} with steps that aren't done", runId);
            ModelState.AddModelError(string.Empty, UnfinishedStepsMessage);
            return ValidationProblem(ModelState);
        }

        run.CompletedAt = DateTimeOffset.UtcNow;

        // Only saves while CompletedAt is still null, so of two overlapping completions the second gets a 409.
        try
        {
            await dbContext.SaveChangesAsync();
        }
        catch (DbUpdateConcurrencyException)
        {
            if (!await RunExistsAsync(runId))
            {
                logger.LogWarning("Run {RunId} deleted while completing it", runId);
                return NotFound();
            }

            logger.LogWarning("Rejected completion of run {RunId} completed while saving", runId);
            return Conflict(new { message = CompletedRunMessage });
        }

        logger.LogInformation("Completed run {RunId}", runId);

        return Ok(await ToResponseAsync(run, await GetChecklistNameAsync(run.ChecklistId)));
    }

    /// <summary>
    /// Saves a run as the device filling it out has it. A device can fill out a checklist with no connection, so it
    /// gives the run a key of its own and sends the whole run once it's online. The first sync creates the run and
    /// later ones update its answers, so a sync sent again after a lost reply changes nothing. The run keeps the steps
    /// as the device showed them, like a run started here keeps the steps it copied: steps added to the checklist
    /// since aren't part of it, and a step deleted since is kept with its answer but can't be linked to the step.
    /// </summary>
    [HttpPut("~/api/checklists/{checklistId:int}/runs/{clientKey:guid}")]
    public async Task<ActionResult<ChecklistRunResponse>> Sync(int checklistId, Guid clientKey, [FromBody] RunSyncRequest request)
    {
        if (clientKey == Guid.Empty)
        {
            ModelState.AddModelError(nameof(clientKey), ClientKeyRequiredMessage);
            return ValidationProblem(ModelState);
        }

        var checklist = await dbContext.Checklists
            .AsNoTracking()
            .FirstOrDefaultAsync(item => item.Id == checklistId);

        if (checklist is null)
        {
            logger.LogWarning("Checklist {ChecklistId} not found for syncing a run", checklistId);
            return NotFound();
        }

        // The run as synced before, or null the first time.
        var existing = await dbContext.ChecklistRuns
            .Include(item => item.Steps)
            .FirstOrDefaultAsync(item => item.ClientKey == clientKey);

        if (existing is not null)
        {
            if (existing.ChecklistId != checklistId)
            {
                logger.LogWarning("Rejected sync of run {RunId} under checklist {ChecklistId}, which isn't its checklist", existing.Id, checklistId);
                return Conflict(new { message = OtherChecklistMessage });
            }

            if (existing.CompletedAt is not null)
            {
                // A completed run never changes. A device that has it complete too is sending its completion again,
                // say after losing the reply, so it gets the run as saved. One that has it open is trying to change it.
                if (request.CompletedAt is null)
                {
                    logger.LogWarning("Rejected sync of completed run {RunId}", existing.Id);
                    return Conflict(new { message = CompletedRunMessage });
                }

                logger.LogInformation("Run {RunId} synced again after it was completed", existing.Id);
                return Ok(await ToResponseAsync(existing, checklist.Name));
            }
        }

        if (request.Steps.Select(step => step.StepId).Distinct().Count() != request.Steps.Count)
        {
            logger.LogWarning("Rejected sync of a run of checklist {ChecklistId} that sends a step twice", checklistId);
            ModelState.AddModelError(nameof(request.Steps), DuplicateStepsMessage);
            return ValidationProblem(ModelState);
        }

        var now = DateTimeOffset.UtcNow;
        var clampedTimes = 0;

        // A device's clock can be ahead, and a time still to come would say a step was done after it was synced.
        DateTimeOffset ClampToNow(DateTimeOffset time)
        {
            if (time <= now)
            {
                return time;
            }

            clampedTimes++;
            return now;
        }

        var checklistSteps = await dbContext.ChecklistSteps
            .AsNoTracking()
            .Include(step => step.Options)
            .Where(step => step.ChecklistId == checklistId)
            .ToDictionaryAsync(step => step.Id);

        // The request's steps paired with the run's, with each one's position in the request for error messages.
        var steps = new List<(RunSyncStepRequest Request, ChecklistRunStep RunStep, int Index)>();
        ChecklistRun run;

        if (existing is null)
        {
            run = new ChecklistRun
            {
                ClientKey = clientKey,
                ChecklistId = checklistId,
                Steps = [.. request.Steps.Select((step, index) => new ChecklistRunStep
                {
                    StepId = checklistSteps.ContainsKey(step.StepId) ? step.StepId : null,
                    StepText = step.Text.Trim(),
                    StepType = step.Type,
                    SortOrder = index
                })]
            };

            dbContext.ChecklistRuns.Add(run);
            steps.AddRange(request.Steps.Select((step, index) => (step, run.Steps[index], index)));
        }
        else
        {
            run = existing;

            // A step the run no longer has was deleted from the checklist since the run was synced, so it can't be
            // filled in any more. Steps the request leaves out are left as they are.
            foreach (var (step, index) in request.Steps.Select((step, index) => (step, index)))
            {
                if (run.Steps.FirstOrDefault(item => item.StepId == step.StepId) is { } runStep)
                {
                    steps.Add((step, runStep, index));
                }
            }

            if (steps.Count < request.Steps.Count)
            {
                logger.LogWarning("Skipped {Count} steps synced to run {RunId} that it no longer has", request.Steps.Count - steps.Count, run.Id);
            }
        }

        run.StartedAt = ClampToNow(request.StartedAt ?? now);

        foreach (var (step, runStep, index) in steps)
        {
            var stepKey = $"{nameof(request.Steps)}[{index}]";
            (int? Id, string Text)? pick = null;

            if (runStep.StepType == StepType.Number && step.ResponseNumber is decimal number && !FitsResponseNumber(number))
            {
                ModelState.AddModelError($"{stepKey}.{nameof(step.ResponseNumber)}", NumberLimitsMessage);
            }
            else if (runStep.StepType == StepType.Choice)
            {
                // The option as it is now, or the text the device showed when the option is no longer on the step.
                var option = runStep.StepId is int stepId && checklistSteps.TryGetValue(stepId, out var checklistStep)
                    ? checklistStep.Options.FirstOrDefault(item => item.Id == step.SelectedOptionId)
                    : null;
                var pickedText = step.SelectedOptionText?.Trim();

                if (option is not null)
                {
                    pick = (option.Id, option.Text);
                }
                else if (!string.IsNullOrEmpty(pickedText))
                {
                    pick = (null, pickedText);
                }
                else if (step.SelectedOptionId is not null)
                {
                    ModelState.AddModelError($"{stepKey}.{nameof(step.SelectedOptionId)}", OptionNotOnStepMessage);
                }
            }

            ApplyResponse(runStep, step.IsDone, step.ResponseText, step.ResponseNumber, pick, now);

            // The device's record of when the step was done, rather than when this sync made it done.
            if (runStep.IsDone)
            {
                runStep.CompletedAt = ClampToNow(step.CompletedAt ?? now);
            }
        }

        // Every done step's prerequisites must be done as well, including a step the request leaves as it is while
        // un-doing one it depends on.
        var dependsOn = await GetDependsOnAsync(run.Steps);
        var indexes = steps.ToDictionary(item => item.RunStep, item => item.Index);

        foreach (var runStep in run.Steps.Where(item => item.IsDone && IsLocked(item, run.Steps, dependsOn)))
        {
            var key = indexes.TryGetValue(runStep, out var index) ? $"{nameof(request.Steps)}[{index}]" : nameof(request.Steps);
            ModelState.AddModelError(key, LockedStepMessage);
        }

        if (request.CompletedAt is DateTimeOffset completedAt)
        {
            // As in Complete, a step deleted from the checklist doesn't hold the run back.
            if (run.Steps.Any(step => !step.IsDone && step.StepId is not null))
            {
                ModelState.AddModelError(nameof(request.CompletedAt), UnfinishedStepsMessage);
            }

            run.CompletedAt = ClampToNow(completedAt);
        }

        if (!ModelState.IsValid)
        {
            logger.LogWarning("Rejected sync of a run of checklist {ChecklistId} with {Count} problems", checklistId, ModelState.ErrorCount);
            return ValidationProblem(ModelState);
        }

        if (clampedTimes > 0)
        {
            logger.LogWarning("Moved {Count} times of a run of checklist {ChecklistId} that were still to come back to now", clampedTimes, checklistId);
        }

        if (existing is not null)
        {
            // As in UpdateStep, so the save can't change a run completed since it was read.
            dbContext.Entry(run).Property(item => item.CompletedAt).IsModified = true;
        }

        try
        {
            await dbContext.SaveChangesAsync();
        }
        catch (DbUpdateConcurrencyException)
        {
            if (!await RunExistsAsync(run.Id))
            {
                logger.LogWarning("Run {RunId} deleted while syncing it", run.Id);
                return NotFound();
            }

            logger.LogWarning("Rejected sync of run {RunId} completed while saving", run.Id);
            return Conflict(new { message = CompletedRunMessage });
        }
        catch (DbUpdateException)
        {
            // Two syncs of a new run overlapped and the other one saved first, so its key is taken now. The device's
            // next sync finds that run.
            if (existing is null && await dbContext.ChecklistRuns.AsNoTracking().AnyAsync(item => item.ClientKey == clientKey))
            {
                logger.LogWarning("Rejected sync of a run of checklist {ChecklistId} created by another request while saving", checklistId);
                return Conflict(new { message = SyncedElsewhereMessage });
            }

            // A picked option was removed from its step after it was checked above, so its foreign key failed the save.
            var pickedOptionIds = run.Steps
                .Where(step => step.SelectedOptionId is not null)
                .Select(step => step.SelectedOptionId!.Value)
                .Distinct()
                .ToList();

            if (pickedOptionIds.Count > 0
                && await dbContext.StepOptions.AsNoTracking().CountAsync(option => pickedOptionIds.Contains(option.Id)) < pickedOptionIds.Count)
            {
                logger.LogWarning("Rejected sync of a run of checklist {ChecklistId} picking an option removed while saving", checklistId);
                ModelState.AddModelError(nameof(request.Steps), OptionNotOnStepMessage);
                return ValidationProblem(ModelState);
            }

            throw;
        }

        var response = await ToResponseAsync(run, checklist.Name);

        if (existing is null)
        {
            logger.LogInformation("Synced new run {RunId} of checklist {ChecklistId}", run.Id, checklistId);
            return CreatedAtAction(nameof(GetById), new { runId = run.Id }, response);
        }

        logger.LogInformation("Synced run {RunId} of checklist {ChecklistId}", run.Id, checklistId);
        return Ok(response);
    }

    // Deletes a run whether it's in progress or complete.
    [HttpDelete("{runId:int}")]
    public async Task<IActionResult> Delete(int runId)
    {
        var run = await dbContext.ChecklistRuns.FirstOrDefaultAsync(item => item.Id == runId);

        if (run is null)
        {
            logger.LogWarning("Run {RunId} not found for deletion", runId);
            return NotFound();
        }

        // SQL Server cascades the delete to the run's steps through the foreign key, but the in-memory provider only
        // cascades to tracked entities, so load them first there.
        if (!dbContext.Database.IsRelational())
        {
            await dbContext.ChecklistRunSteps.Where(step => step.RunId == runId).LoadAsync();
        }

        dbContext.ChecklistRuns.Remove(run);

        try
        {
            await dbContext.SaveChangesAsync();
        }
        catch (DbUpdateConcurrencyException)
        {
            var runEntry = dbContext.Entry(run);

            // Another request deleted it first, which is what this one wanted.
            if (await runEntry.GetDatabaseValuesAsync() is not { } databaseValues)
            {
                logger.LogWarning("Run {RunId} deleted by another request while deleting it", runId);
                return NoContent();
            }

            // It was completed since it was read, and CompletedAt is a concurrency token, so delete it with the
            // saved value. A run is only completed once, so this can't conflict again.
            runEntry.OriginalValues.SetValues(databaseValues);
            await dbContext.SaveChangesAsync();
        }

        logger.LogInformation("Deleted run {RunId}", runId);

        return NoContent();
    }

    private async Task<bool> RunExistsAsync(int runId)
    {
        return await dbContext.ChecklistRuns.AsNoTracking().AnyAsync(item => item.Id == runId);
    }

    // Matches the DECIMAL(15, 6) ResponseNumber column, which would otherwise round or overflow.
    private static bool FitsResponseNumber(decimal number)
    {
        return Math.Abs(number) < MaxResponseNumber && decimal.Round(number, 6) == number;
    }

    // Each step type reads its own value and decides from it whether the step is done, and a step that becomes done
    // here is done at completedAt. A choice step's pick is the option's ID while it's one of the step's options, or
    // null with the option's text once it's been removed, which still counts as done.
    private static void ApplyResponse(
        ChecklistRunStep runStep,
        bool isTicked,
        string? text,
        decimal? number,
        (int? Id, string Text)? pick,
        DateTimeOffset completedAt)
    {
        bool isDone;

        switch (runStep.StepType)
        {
            case StepType.Text:
                var trimmedText = text?.Trim();
                runStep.ResponseText = string.IsNullOrEmpty(trimmedText) ? null : trimmedText;
                isDone = runStep.ResponseText is not null;
                break;
            case StepType.Number:
                runStep.ResponseNumber = number;
                isDone = runStep.ResponseNumber is not null;
                break;
            case StepType.Choice:
                runStep.SelectedOptionId = pick?.Id;
                runStep.SelectedOptionText = pick?.Text;
                isDone = pick is not null;
                break;
            default:
                isDone = isTicked;
                break;
        }

        if (runStep.IsDone != isDone)
        {
            runStep.IsDone = isDone;
            runStep.CompletedAt = isDone ? completedAt : null;
        }
    }

    private async Task<string> GetChecklistNameAsync(int checklistId)
    {
        // Runs are deleted with their checklist, so the checklist is always there.
        return await dbContext.Checklists
            .AsNoTracking()
            .Where(item => item.Id == checklistId)
            .Select(item => item.Name)
            .SingleAsync();
    }

    // The current options of each choice step, by step ID. A deleted step has none.
    private async Task<ILookup<int, StepOption>> GetOptionsAsync(IEnumerable<ChecklistRunStep> runSteps)
    {
        var stepIds = runSteps
            .Where(step => step.StepType == StepType.Choice && step.StepId is not null)
            .Select(step => step.StepId!.Value)
            .ToList();

        if (stepIds.Count == 0)
        {
            return Array.Empty<StepOption>().ToLookup(option => option.StepId);
        }

        var options = await dbContext.StepOptions
            .AsNoTracking()
            .Where(option => stepIds.Contains(option.StepId))
            .ToListAsync();

        return options.ToLookup(option => option.StepId);
    }

    // The steps each step of the run depends on now, by step ID, leaving out any that aren't in the run because they
    // were added to the checklist after it started. A deleted step has none, and none depend on it any more.
    private async Task<ILookup<int, int>> GetDependsOnAsync(IReadOnlyCollection<ChecklistRunStep> runSteps)
    {
        var stepIds = runSteps
            .Where(step => step.StepId is not null)
            .Select(step => step.StepId!.Value)
            .ToList();

        if (stepIds.Count == 0)
        {
            return Array.Empty<StepDependency>().ToLookup(dependency => dependency.StepId, dependency => dependency.DependsOnStepId);
        }

        var dependencies = await dbContext.StepDependencies
            .AsNoTracking()
            .Where(dependency => stepIds.Contains(dependency.StepId) && stepIds.Contains(dependency.DependsOnStepId))
            .ToListAsync();

        return dependencies.ToLookup(dependency => dependency.StepId, dependency => dependency.DependsOnStepId);
    }

    // A step is locked while a step it depends on isn't done, and can't be filled in until it is.
    private static bool IsLocked(ChecklistRunStep step, IEnumerable<ChecklistRunStep> runSteps, ILookup<int, int> dependsOn)
    {
        return step.StepId is int stepId
            && runSteps.Any(item => !item.IsDone && item.StepId is int id && dependsOn[stepId].Contains(id));
    }

    private async Task<ChecklistRunResponse> ToResponseAsync(ChecklistRun run, string checklistName)
    {
        var options = await GetOptionsAsync(run.Steps);
        var dependsOn = await GetDependsOnAsync(run.Steps);
        var steps = run.Steps
            .OrderBy(step => step.SortOrder)
            .ThenBy(step => step.Id)
            .Select(step => step.StepId is int stepId
                ? ChecklistRunStepResponse.From(step, options[stepId], dependsOn[stepId], IsLocked(step, run.Steps, dependsOn))
                : ChecklistRunStepResponse.From(step, [], [], false))
            .ToList();

        return new(run.Id, run.ClientKey, run.ChecklistId, checklistName, run.StartedAt, run.CompletedAt, steps);
    }
}
