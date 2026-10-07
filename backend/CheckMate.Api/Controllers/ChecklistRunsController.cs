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

        // Copy each step's text and position into the run, so later edits to the checklist don't change it.
        var run = new ChecklistRun
        {
            ChecklistId = checklistId,
            StartedAt = DateTimeOffset.UtcNow,
            Responses = [.. steps.Select((step, index) => new RunStepResponse
            {
                StepId = step.Id,
                StepText = step.Text,
                SortOrder = index
            })]
        };

        dbContext.ChecklistRuns.Add(run);
        await dbContext.SaveChangesAsync();

        logger.LogInformation("Started run {RunId} of checklist {ChecklistId}", run.Id, checklistId);

        return CreatedAtAction(nameof(GetById), new { runId = run.Id }, ToResponse(run, checklist.Name));
    }

    [HttpGet("{runId:int}")]
    public async Task<ActionResult<ChecklistRunResponse>> GetById(int runId)
    {
        logger.LogInformation("Retrieving run {RunId}", runId);

        var run = await dbContext.ChecklistRuns
            .AsNoTracking()
            .Include(item => item.Responses)
            .FirstOrDefaultAsync(item => item.Id == runId);

        if (run is null)
        {
            logger.LogWarning("Run {RunId} not found", runId);
            return NotFound();
        }

        return Ok(ToResponse(run, await GetChecklistNameAsync(run.ChecklistId)));
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

        var response = await dbContext.RunStepResponses
            .FirstOrDefaultAsync(item => item.RunId == runId && item.StepId == stepId);

        if (response is null)
        {
            logger.LogWarning("Step {StepId} not found in run {RunId}", stepId, runId);
            return NotFound();
        }

        if (run.CompletedAt is not null)
        {
            logger.LogWarning("Rejected step update for completed run {RunId}", runId);
            return Conflict(new { message = CompletedRunMessage });
        }

        if (response.IsDone != request.IsDone)
        {
            response.IsDone = request.IsDone;
            response.CompletedAt = request.IsDone ? DateTimeOffset.UtcNow : null;
            await dbContext.SaveChangesAsync();
        }

        logger.LogInformation("Saved step {StepId} in run {RunId}", stepId, runId);

        return Ok(ChecklistRunStepResponse.From(response));
    }

    [HttpPost("{runId:int}/complete")]
    public async Task<ActionResult<ChecklistRunResponse>> Complete(int runId)
    {
        var run = await dbContext.ChecklistRuns
            .Include(item => item.Responses)
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
        await dbContext.SaveChangesAsync();

        logger.LogInformation("Completed run {RunId}", runId);

        return Ok(ToResponse(run, await GetChecklistNameAsync(run.ChecklistId)));
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

    private static ChecklistRunResponse ToResponse(ChecklistRun run, string checklistName)
    {
        var steps = run.Responses
            .OrderBy(response => response.SortOrder)
            .ThenBy(response => response.Id)
            .Select(ChecklistRunStepResponse.From)
            .ToList();

        return new(run.Id, run.ChecklistId, checklistName, run.StartedAt, run.CompletedAt, steps);
    }
}
