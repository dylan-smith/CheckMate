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
    private const int MinChoiceOptions = 2;

    private const string OptionPickedWhileSavingMessage =
        "A fill-out picked one of the removed options while this was saving. Try saving again.";

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
            .Include(step => step.Options)
            .Where(step => step.ChecklistId == checklistId)
            .OrderBy(step => step.SortOrder)
            .ThenBy(step => step.Id)
            .ToListAsync();

        return Ok(steps.Select(ChecklistStepResponse.From).ToList());
    }

    [HttpGet("{stepId:int}")]
    public async Task<ActionResult<ChecklistStepResponse>> GetById(int checklistId, int stepId)
    {
        logger.LogInformation("Retrieving step {StepId} of checklist {ChecklistId}", stepId, checklistId);

        var step = await dbContext.ChecklistSteps
            .AsNoTracking()
            .Include(item => item.Options)
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

        // A new step has no options yet, so none of them can name an existing one.
        var options = ValidateOptions(request, new HashSet<int>());

        if (options is null)
        {
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
            Type = request.Type,
            SortOrder = (maxSortOrder ?? -1) + 1,
            Options = [.. options.Select((option, index) => new StepOption { Text = option.Text, SortOrder = index })]
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
            .Include(item => item.Options)
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

        var options = ValidateOptions(request, step.Options.Select(option => option.Id).ToHashSet());

        if (options is null)
        {
            return ValidationProblem(ModelState);
        }

        step.Text = trimmedText;
        step.Type = request.Type;
        var (removedIds, clearedRunStepIds) = await ReplaceOptionsAsync(step, options);

        try
        {
            await dbContext.SaveChangesAsync();
        }
        catch (DbUpdateException) when (removedIds.Count > 0)
        {
            // A fill-out that picked one of the removed options after ReplaceOptionsAsync cleared the runs that had
            // fails the option's foreign key. Nothing was saved, and trying again clears that pick too. Any other
            // failure isn't that, so it's thrown on. The failed save left the runs this cleared with their picks,
            // so those don't count.
            if (!await IsAnyOptionPickedAsync(removedIds, clearedRunStepIds))
            {
                throw;
            }

            logger.LogWarning("Rejected update of step {StepId} in checklist {ChecklistId} whose removed option was picked while saving", stepId, checklistId);
            return Conflict(new { message = OptionPickedWhileSavingMessage });
        }

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
            .Include(step => step.Options)
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
        // The options are loaded so the in-memory provider, which only cascades to tracked entities, deletes them too.
        var step = await dbContext.ChecklistSteps
            .Include(item => item.Options)
            .FirstOrDefaultAsync(item => item.Id == stepId && item.ChecklistId == checklistId);

        if (step is null)
        {
            logger.LogWarning("Step {StepId} of checklist {ChecklistId} not found for deletion", stepId, checklistId);
            return NotFound();
        }

        // Runs keep their copy of the step text and of the picked option's text, so they only lose the links to the
        // deleted step and its options.
        var runSteps = await dbContext.ChecklistRunSteps.Where(runStep => runStep.StepId == stepId).ToListAsync();

        foreach (var runStep in runSteps)
        {
            runStep.StepId = null;
            runStep.SelectedOptionId = null;
            // Write the null even when the run had no pick when it was read, so a pick saved since is cleared too.
            // The UPDATE also locks the row until the delete commits, so a pick saved after it fails on the
            // deleted option's foreign key instead of failing the delete.
            dbContext.Entry(runStep).Property(item => item.SelectedOptionId).IsModified = true;
        }

        dbContext.ChecklistSteps.Remove(step);
        await dbContext.SaveChangesAsync();

        logger.LogInformation("Deleted step {StepId} from checklist {ChecklistId}", stepId, checklistId);

        return NoContent();
    }

    // Checks the options suit the step's type and returns them trimmed, or adds the problems to ModelState and
    // returns null. An option that has an ID must be one the step already has.
    private List<StepOptionRequest>? ValidateOptions(ChecklistStepRequest request, IReadOnlySet<int> existingOptionIds)
    {
        var options = request.Options ?? [];

        if (request.Type != StepType.Choice)
        {
            if (options.Count > 0)
            {
                ModelState.AddModelError(nameof(request.Options), "Only choice steps have options.");
                return null;
            }

            return [];
        }

        var trimmed = options
            .Select(option => new StepOptionRequest { Id = option.Id, Text = option.Text.Trim() })
            .ToList();
        var ids = trimmed.Where(option => option.Id is not null).Select(option => option.Id!.Value).ToList();

        if (trimmed.Count < MinChoiceOptions)
        {
            ModelState.AddModelError(nameof(request.Options), $"A choice step needs at least {MinChoiceOptions} options.");
        }
        else if (trimmed.Any(option => option.Text.Length == 0))
        {
            ModelState.AddModelError(nameof(request.Options), "Option text is required.");
        }
        else if (trimmed.Select(option => option.Text).Distinct(StringComparer.OrdinalIgnoreCase).Count() != trimmed.Count)
        {
            ModelState.AddModelError(nameof(request.Options), "Each option must be different.");
        }
        else if (ids.Distinct().Count() != ids.Count || !ids.All(existingOptionIds.Contains))
        {
            ModelState.AddModelError(nameof(request.Options), "The option IDs must be options of this step.");
        }

        return ModelState.IsValid ? trimmed : null;
    }

    // Whether a run other than the given ones has picked any of these options, as saved in the database rather than
    // as this request read it.
    private Task<bool> IsAnyOptionPickedAsync(List<int> optionIds, List<int> exceptRunStepIds)
    {
        return dbContext.ChecklistRunSteps
            .AsNoTracking()
            .AnyAsync(runStep => runStep.SelectedOptionId != null
                && optionIds.Contains(runStep.SelectedOptionId.Value)
                && !exceptRunStepIds.Contains(runStep.Id));
    }

    // Updates the options that are kept, adds the new ones and removes the rest, so a kept option keeps its ID.
    // Returns the IDs of the ones removed, and of the run steps whose pick of one of them it cleared.
    private async Task<(List<int> RemovedIds, List<int> ClearedRunStepIds)> ReplaceOptionsAsync(
        ChecklistStep step,
        List<StepOptionRequest> options)
    {
        var keptIds = options.Where(option => option.Id is not null).Select(option => option.Id!.Value).ToHashSet();
        var removed = step.Options.Where(option => !keptIds.Contains(option.Id)).ToList();
        var removedIds = removed.Select(option => option.Id).ToList();
        List<int> clearedRunStepIds = [];

        if (removed.Count > 0)
        {
            // Runs keep the removed options' text, so they only lose the links to them.
            var runSteps = await dbContext.ChecklistRunSteps
                .Where(runStep => runStep.SelectedOptionId != null && removedIds.Contains(runStep.SelectedOptionId.Value))
                .ToListAsync();

            foreach (var runStep in runSteps)
            {
                runStep.SelectedOptionId = null;
                clearedRunStepIds.Add(runStep.Id);
            }

            foreach (var option in removed)
            {
                step.Options.Remove(option);
            }

            dbContext.StepOptions.RemoveRange(removed);
        }

        var kept = step.Options.ToDictionary(option => option.Id);

        for (var index = 0; index < options.Count; index++)
        {
            if (options[index].Id is int id)
            {
                kept[id].Text = options[index].Text;
                kept[id].SortOrder = index;
            }
            else
            {
                step.Options.Add(new StepOption { Text = options[index].Text, SortOrder = index });
            }
        }

        return (removedIds, clearedRunStepIds);
    }

    private Task<bool> ChecklistExistsAsync(int checklistId)
    {
        return dbContext.Checklists.AsNoTracking().AnyAsync(item => item.Id == checklistId);
    }
}
