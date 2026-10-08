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

        if (existing is not null && await RefuseSyncOfSettledRunAsync(existing, checklistId, request, checklist.Name) is { } refusal)
        {
            return refusal;
        }

        if (request.Steps.Select(step => step.StepId).Distinct().Count() != request.Steps.Count)
        {
            logger.LogWarning("Rejected sync of a run of checklist {ChecklistId} that sends a step twice", checklistId);
            ModelState.AddModelError(nameof(request.Steps), DuplicateStepsMessage);
            return ValidationProblem(ModelState);
        }

        var checklistSteps = await dbContext.ChecklistSteps
            .AsNoTracking()
            .Include(step => step.Options)
            .Where(step => step.ChecklistId == checklistId)
            .ToDictionaryAsync(step => step.Id);
        var clock = new SyncClock();
        var run = existing ?? AddSyncedRun(clientKey, checklistId, request, checklistSteps);
        var steps = PairSyncedSteps(run, request, isNew: existing is null);

        run.StartedAt = clock.ClampToNow(request.StartedAt);

        foreach (var step in steps)
        {
            ApplySyncedStep(step, checklistSteps, clock);
        }

        await AddLockedStepErrorsAsync(run, steps);

        if (request.CompletedAt is DateTimeOffset completedAt)
        {
            CompleteSyncedRun(run, completedAt, clock);
        }

        if (!ModelState.IsValid)
        {
            logger.LogWarning("Rejected sync of a run of checklist {ChecklistId} with {Count} problems", checklistId, ModelState.ErrorCount);
            return ValidationProblem(ModelState);
        }

        if (clock.ClampedTimes > 0)
        {
            logger.LogWarning("Moved {Count} times of a run of checklist {ChecklistId} that were still to come back to now", clock.ClampedTimes, checklistId);
        }

        if (await SaveSyncedRunAsync(run, clientKey, isNew: existing is null) is { } saveFailure)
        {
            return saveFailure;
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

    // The time a sync is saved at, and how it treats the times the device sent. A device's clock can be ahead, and
    // a time still to come would say a step was done after it was synced, so those are moved back to now and counted.
    private sealed class SyncClock
    {
        public DateTimeOffset Now { get; } = DateTimeOffset.UtcNow;

        public int ClampedTimes { get; private set; }

        // A missing time means now, as when a device didn't record when a step was done.
        public DateTimeOffset ClampToNow(DateTimeOffset? time)
        {
            if (time is null || time <= Now)
            {
                return time ?? Now;
            }

            ClampedTimes++;
            return Now;
        }
    }

    // A step of the request paired with the run step it answers, and its position in the request for error messages.
    private readonly record struct SyncedStep(RunSyncStepRequest Request, ChecklistRunStep RunStep, int Index)
    {
        public string Key => $"{nameof(RunSyncRequest.Steps)}[{Index}]";
    }

    // Why a sync can't change the run it found, or null when it can. A run synced under another checklist's URL is a
    // conflict. A completed run never changes: a device that has it complete too is sending its completion again,
    // say after losing the reply, so it gets the run as saved, while one that has it open is trying to change it.
    private async Task<ActionResult<ChecklistRunResponse>?> RefuseSyncOfSettledRunAsync(
        ChecklistRun existing,
        int checklistId,
        RunSyncRequest request,
        string checklistName)
    {
        if (existing.ChecklistId != checklistId)
        {
            logger.LogWarning("Rejected sync of run {RunId} under checklist {ChecklistId}, which isn't its checklist", existing.Id, checklistId);
            return Conflict(new { message = OtherChecklistMessage });
        }

        if (existing.CompletedAt is null)
        {
            return null;
        }

        if (request.CompletedAt is null)
        {
            logger.LogWarning("Rejected sync of completed run {RunId}", existing.Id);
            return Conflict(new { message = CompletedRunMessage });
        }

        logger.LogInformation("Run {RunId} synced again after it was completed", existing.Id);
        return Ok(await ToResponseAsync(existing, checklistName));
    }

    // A run with a copy of each step as the device showed it, in the request's order. A step the checklist no longer
    // has is kept without a link to it, like a step deleted after an online run.
    private ChecklistRun AddSyncedRun(
        Guid clientKey,
        int checklistId,
        RunSyncRequest request,
        Dictionary<int, ChecklistStep> checklistSteps)
    {
        var run = new ChecklistRun
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
        return run;
    }

    // A new run's steps match the request one to one. An existing run's are matched by step: one the run no longer
    // has was deleted from the checklist since the run was synced, so it can't be filled in any more, and steps the
    // request leaves out are left as they are.
    private List<SyncedStep> PairSyncedSteps(ChecklistRun run, RunSyncRequest request, bool isNew)
    {
        if (isNew)
        {
            return [.. request.Steps.Select((step, index) => new SyncedStep(step, run.Steps[index], index))];
        }

        var steps = new List<SyncedStep>();

        foreach (var (step, index) in request.Steps.Select((step, index) => (step, index)))
        {
            if (run.Steps.FirstOrDefault(item => item.StepId == step.StepId) is { } runStep)
            {
                steps.Add(new(step, runStep, index));
            }
        }

        if (steps.Count < request.Steps.Count)
        {
            logger.LogWarning("Skipped {Count} steps synced to run {RunId} that it no longer has", request.Steps.Count - steps.Count, run.Id);
        }

        return steps;
    }

    // Applies the device's answer to a step, done at the time the device recorded rather than when this sync made it
    // done. An answer the API can't keep goes in ModelState under the step's position in the request.
    private void ApplySyncedStep(SyncedStep synced, Dictionary<int, ChecklistStep> checklistSteps, SyncClock clock)
    {
        var (step, runStep, _) = synced;
        (int? Id, string Text)? pick = null;

        if (runStep.StepType == StepType.Number && step.ResponseNumber is decimal number && !FitsResponseNumber(number))
        {
            ModelState.AddModelError($"{synced.Key}.{nameof(step.ResponseNumber)}", NumberLimitsMessage);
        }
        else if (runStep.StepType == StepType.Choice)
        {
            pick = ResolveSyncedPick(synced, checklistSteps);
        }

        ApplyResponse(runStep, step.IsDone, step.ResponseText, step.ResponseNumber, pick, clock.Now);

        if (runStep.IsDone)
        {
            runStep.CompletedAt = clock.ClampToNow(step.CompletedAt);
        }
    }

    // The option a choice step picked, as it is now, or the text the device showed when the option is no longer on
    // the step. Null when nothing was picked, or when the pick can't be kept.
    private (int? Id, string Text)? ResolveSyncedPick(SyncedStep synced, Dictionary<int, ChecklistStep> checklistSteps)
    {
        var (step, runStep, _) = synced;
        var option = runStep.StepId is int stepId && checklistSteps.TryGetValue(stepId, out var checklistStep)
            ? checklistStep.Options.FirstOrDefault(item => item.Id == step.SelectedOptionId)
            : null;

        if (option is not null)
        {
            return (option.Id, option.Text);
        }

        var pickedText = step.SelectedOptionText?.Trim();

        if (!string.IsNullOrEmpty(pickedText))
        {
            return (null, pickedText);
        }

        if (step.SelectedOptionId is not null)
        {
            ModelState.AddModelError($"{synced.Key}.{nameof(step.SelectedOptionId)}", OptionNotOnStepMessage);
        }

        return null;
    }

    // Every done step's prerequisites must be done as well, including a step the request leaves as it is while
    // un-doing one it depends on, which has no position in the request to report under.
    private async Task AddLockedStepErrorsAsync(ChecklistRun run, IReadOnlyCollection<SyncedStep> steps)
    {
        var dependsOn = await GetDependsOnAsync(run.Steps);
        var keys = steps.ToDictionary(item => item.RunStep, item => item.Key);

        foreach (var runStep in run.Steps.Where(item => item.IsDone && IsLocked(item, run.Steps, dependsOn)))
        {
            ModelState.AddModelError(keys.GetValueOrDefault(runStep, nameof(RunSyncRequest.Steps)), LockedStepMessage);
        }
    }

    // As in Complete, every step must be done first, except a step deleted from the checklist, which doesn't hold the
    // run back.
    private void CompleteSyncedRun(ChecklistRun run, DateTimeOffset completedAt, SyncClock clock)
    {
        if (run.Steps.Any(step => !step.IsDone && step.StepId is not null))
        {
            ModelState.AddModelError(nameof(RunSyncRequest.CompletedAt), UnfinishedStepsMessage);
        }

        run.CompletedAt = clock.ClampToNow(completedAt);
    }

    // Saves the synced run, and says why it couldn't when another request got there first: the run was completed
    // or deleted since it was read, another sync created it, or a picked option was removed. Null once saved.
    private async Task<ActionResult<ChecklistRunResponse>?> SaveSyncedRunAsync(ChecklistRun run, Guid clientKey, bool isNew)
    {
        if (!isNew)
        {
            // As in UpdateStep, so the save can't change a run completed since it was read.
            dbContext.Entry(run).Property(item => item.CompletedAt).IsModified = true;
        }

        try
        {
            await dbContext.SaveChangesAsync();
            return null;
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
            if (isNew && await dbContext.ChecklistRuns.AsNoTracking().AnyAsync(item => item.ClientKey == clientKey))
            {
                logger.LogWarning("Rejected sync of a run of checklist {ChecklistId} created by another request while saving", run.ChecklistId);
                return Conflict(new { message = SyncedElsewhereMessage });
            }

            // A picked option was removed from its step after it was checked, so its foreign key failed the save.
            var pickedOptionIds = run.Steps
                .Where(step => step.SelectedOptionId is not null)
                .Select(step => step.SelectedOptionId!.Value)
                .Distinct()
                .ToList();

            if (pickedOptionIds.Count > 0
                && await dbContext.StepOptions.AsNoTracking().CountAsync(option => pickedOptionIds.Contains(option.Id)) < pickedOptionIds.Count)
            {
                logger.LogWarning("Rejected sync of a run of checklist {ChecklistId} picking an option removed while saving", run.ChecklistId);
                ModelState.AddModelError(nameof(RunSyncRequest.Steps), OptionNotOnStepMessage);
                return ValidationProblem(ModelState);
            }

            throw;
        }
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
