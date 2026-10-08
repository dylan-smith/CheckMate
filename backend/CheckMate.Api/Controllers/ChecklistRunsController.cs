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
            .Select(run => new ChecklistRunSummaryResponse(run.Id, run.StartedAt, run.CompletedAt))
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

        ApplyResponse(runStep, request, selectedOption);

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
        catch (DbUpdateConcurrencyException exception)
        {
            // Another request deleted it first, which is what this one wanted.
            if (!await RunExistsAsync(runId))
            {
                logger.LogWarning("Run {RunId} deleted by another request while deleting it", runId);
                return NoContent();
            }

            // It was completed since it was read, and CompletedAt is a concurrency token, so delete it with the
            // saved value. A run is only completed once, so this can't conflict again.
            foreach (var entry in exception.Entries)
            {
                if (await entry.GetDatabaseValuesAsync() is { } databaseValues)
                {
                    entry.OriginalValues.SetValues(databaseValues);
                }
            }

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

    // Each step type reads its own field of the request and decides from it whether the step is done. A choice step
    // uses the option the request picked, already checked to be one of its options.
    private static void ApplyResponse(ChecklistRunStep runStep, RunStepRequest request, StepOption? selectedOption)
    {
        bool isDone;

        switch (runStep.StepType)
        {
            case StepType.Text:
                var trimmedText = request.Text?.Trim();
                runStep.ResponseText = string.IsNullOrEmpty(trimmedText) ? null : trimmedText;
                isDone = runStep.ResponseText is not null;
                break;
            case StepType.Number:
                runStep.ResponseNumber = request.Number;
                isDone = runStep.ResponseNumber is not null;
                break;
            case StepType.Choice:
                runStep.SelectedOptionId = selectedOption?.Id;
                runStep.SelectedOptionText = selectedOption?.Text;
                isDone = selectedOption is not null;
                break;
            default:
                isDone = request.IsDone;
                break;
        }

        if (runStep.IsDone != isDone)
        {
            runStep.IsDone = isDone;
            runStep.CompletedAt = isDone ? DateTimeOffset.UtcNow : null;
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

        return new(run.Id, run.ChecklistId, checklistName, run.StartedAt, run.CompletedAt, steps);
    }
}
