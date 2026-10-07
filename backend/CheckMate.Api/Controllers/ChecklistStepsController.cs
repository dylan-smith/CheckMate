using CheckMate.Api.Contracts;
using CheckMate.Api.Data;
using CheckMate.Api.Models;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace CheckMate.Api.Controllers;

/// <remarks>
/// Log statements use structured logging with typed route parameters (e.g. int stepId) only.
/// User-provided strings such as step text are intentionally excluded to prevent log-forging.
/// </remarks>
[ApiController]
[Route("api/checklists/{checklistId:int}/steps")]
public class ChecklistStepsController(ChecklistDbContext dbContext, ILogger<ChecklistStepsController> logger) : ControllerBase
{
    [HttpGet]
    public async Task<ActionResult<IEnumerable<ChecklistStepResponse>>> GetAll(int checklistId)
    {
        logger.LogInformation("Retrieving steps for checklist {ChecklistId}", checklistId);

        if (!await ChecklistExistsAsync(checklistId))
        {
            logger.LogWarning("Checklist {ChecklistId} not found", checklistId);
            return NotFound();
        }

        var steps = await dbContext.ChecklistSteps
            .AsNoTracking()
            .Where(step => step.ChecklistId == checklistId)
            .OrderBy(step => step.SortOrder)
            .ThenBy(step => step.Id)
            .Select(step => new ChecklistStepResponse(step.Id, step.Text, step.SortOrder))
            .ToListAsync();

        return Ok(steps);
    }

    [HttpGet("{stepId:int}")]
    public async Task<ActionResult<ChecklistStepResponse>> GetById(int checklistId, int stepId)
    {
        logger.LogInformation("Retrieving step {StepId} of checklist {ChecklistId}", stepId, checklistId);

        var step = await dbContext.ChecklistSteps
            .AsNoTracking()
            .FirstOrDefaultAsync(item => item.Id == stepId && item.ChecklistId == checklistId);

        if (step is null)
        {
            logger.LogWarning("Step {StepId} of checklist {ChecklistId} not found", stepId, checklistId);
            return NotFound();
        }

        return Ok(ChecklistStepResponse.From(step));
    }

    [HttpPost]
    public async Task<ActionResult<ChecklistStepResponse>> Create(int checklistId, [FromBody] ChecklistStepRequest request)
    {
        if (!await ChecklistExistsAsync(checklistId))
        {
            logger.LogWarning("Checklist {ChecklistId} not found for step creation", checklistId);
            return NotFound();
        }

        var trimmedText = request.Text.Trim();

        if (trimmedText.Length == 0)
        {
            ModelState.AddModelError(nameof(request.Text), "Step text is required.");
            return ValidationProblem(ModelState);
        }

        // New steps go at the end of the checklist.
        var maxSortOrder = await dbContext.ChecklistSteps
            .Where(item => item.ChecklistId == checklistId)
            .MaxAsync(item => (int?)item.SortOrder);

        var step = new ChecklistStep
        {
            ChecklistId = checklistId,
            Text = trimmedText,
            SortOrder = (maxSortOrder ?? -1) + 1
        };

        dbContext.ChecklistSteps.Add(step);
        await dbContext.SaveChangesAsync();

        logger.LogInformation("Created step {StepId} in checklist {ChecklistId}", step.Id, checklistId);

        return CreatedAtAction(nameof(GetById), new { checklistId, stepId = step.Id }, ChecklistStepResponse.From(step));
    }

    [HttpPut("{stepId:int}")]
    public async Task<ActionResult<ChecklistStepResponse>> Update(int checklistId, int stepId, [FromBody] ChecklistStepRequest request)
    {
        var step = await dbContext.ChecklistSteps
            .FirstOrDefaultAsync(item => item.Id == stepId && item.ChecklistId == checklistId);

        if (step is null)
        {
            logger.LogWarning("Step {StepId} of checklist {ChecklistId} not found for update", stepId, checklistId);
            return NotFound();
        }

        var trimmedText = request.Text.Trim();

        if (trimmedText.Length == 0)
        {
            ModelState.AddModelError(nameof(request.Text), "Step text is required.");
            return ValidationProblem(ModelState);
        }

        step.Text = trimmedText;
        await dbContext.SaveChangesAsync();

        logger.LogInformation("Updated step {StepId} in checklist {ChecklistId}", stepId, checklistId);

        return Ok(ChecklistStepResponse.From(step));
    }

    [HttpPut("order")]
    public async Task<ActionResult<IEnumerable<ChecklistStepResponse>>> Reorder(int checklistId, [FromBody] ChecklistStepOrderRequest request)
    {
        if (!await ChecklistExistsAsync(checklistId))
        {
            logger.LogWarning("Checklist {ChecklistId} not found for step reordering", checklistId);
            return NotFound();
        }

        var steps = await dbContext.ChecklistSteps
            .Where(step => step.ChecklistId == checklistId)
            .ToDictionaryAsync(step => step.Id);

        // The list must name every step exactly once, so a stale list (one that misses a step added since
        // the caller loaded the checklist, or still has one that was deleted) is rejected rather than guessed at.
        if (request.StepIds.Count != steps.Count
            || request.StepIds.Distinct().Count() != steps.Count
            || !request.StepIds.All(steps.ContainsKey))
        {
            logger.LogWarning("Rejected step order for checklist {ChecklistId} that doesn't match its steps", checklistId);
            ModelState.AddModelError(nameof(request.StepIds), "The step IDs must match the checklist's steps exactly.");
            return ValidationProblem(ModelState);
        }

        for (var index = 0; index < request.StepIds.Count; index++)
        {
            var step = steps[request.StepIds[index]];
            step.SortOrder = index;
            // Write every position, not just the ones that differ from what this request read, so a reorder
            // saved in between can't leave a mix of both orders.
            dbContext.Entry(step).Property(item => item.SortOrder).IsModified = true;
        }

        await dbContext.SaveChangesAsync();

        logger.LogInformation("Reordered {StepCount} steps in checklist {ChecklistId}", steps.Count, checklistId);

        return Ok(request.StepIds.Select(stepId => ChecklistStepResponse.From(steps[stepId])).ToList());
    }

    [HttpDelete("{stepId:int}")]
    public async Task<IActionResult> Delete(int checklistId, int stepId)
    {
        var step = await dbContext.ChecklistSteps
            .FirstOrDefaultAsync(item => item.Id == stepId && item.ChecklistId == checklistId);

        if (step is null)
        {
            logger.LogWarning("Step {StepId} of checklist {ChecklistId} not found for deletion", stepId, checklistId);
            return NotFound();
        }

        // Runs keep their copy of the step text, so they only lose the link to the deleted step.
        var responses = await dbContext.RunStepResponses.Where(response => response.StepId == stepId).ToListAsync();

        foreach (var response in responses)
        {
            response.StepId = null;
        }

        dbContext.ChecklistSteps.Remove(step);
        await dbContext.SaveChangesAsync();

        logger.LogInformation("Deleted step {StepId} from checklist {ChecklistId}", stepId, checklistId);

        return NoContent();
    }

    private Task<bool> ChecklistExistsAsync(int checklistId)
    {
        return dbContext.Checklists.AsNoTracking().AnyAsync(item => item.Id == checklistId);
    }
}
