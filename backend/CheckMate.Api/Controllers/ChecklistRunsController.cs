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

        var runStep = await dbContext.ChecklistRunSteps
            .FirstOrDefaultAsync(item => item.RunId == runId && item.StepId == stepId);

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

        ApplyResponse(runStep, request, selectedOption);

        // Write the run's CompletedAt back unchanged, so the save checks the run is still open in the same
        // transaction (see IsConcurrencyToken in ChecklistDbContext) and can't change a run completed since it was read.
        dbContext.Entry(run).Property(item => item.CompletedAt).IsModified = true;

        try
        {
            await dbContext.SaveChangesAsync();
        }
        catch (DbUpdateConcurrencyException)
        {
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

        return Ok(ChecklistRunStepResponse.From(runStep, options[stepId]));
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

        run.CompletedAt = DateTimeOffset.UtcNow;

        // Only saves while CompletedAt is still null, so of two overlapping completions the second gets a 409.
        try
        {
            await dbContext.SaveChangesAsync();
        }
        catch (DbUpdateConcurrencyException)
        {
            logger.LogWarning("Rejected completion of run {RunId} completed while saving", runId);
            return Conflict(new { message = CompletedRunMessage });
        }

        logger.LogInformation("Completed run {RunId}", runId);

        return Ok(await ToResponseAsync(run, await GetChecklistNameAsync(run.ChecklistId)));
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

    private async Task<ChecklistRunResponse> ToResponseAsync(ChecklistRun run, string checklistName)
    {
        var options = await GetOptionsAsync(run.Steps);
        var steps = run.Steps
            .OrderBy(step => step.SortOrder)
            .ThenBy(step => step.Id)
            .Select(step => ChecklistRunStepResponse.From(step, step.StepId is int stepId ? options[stepId] : []))
            .ToList();

        return new(run.Id, run.ChecklistId, checklistName, run.StartedAt, run.CompletedAt, steps);
    }
}
