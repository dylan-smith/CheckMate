using CheckMate.Api.Contracts;
using CheckMate.Api.Data;
using CheckMate.Api.Models;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace CheckMate.Api.Controllers;

/// <remarks>
/// Log statements use structured logging with typed route parameters (e.g. int id) only.
/// User-provided strings such as checklist names are intentionally excluded to prevent log-forging.
/// </remarks>
[ApiController]
[Route("api/[controller]")]
public partial class ChecklistsController(ChecklistDbContext dbContext, ILogger<ChecklistsController> logger) : ControllerBase
{
    [HttpGet]
    public async Task<ActionResult<IEnumerable<Checklist>>> GetAll()
    {
        LogRetrievingAll(logger);

        var checklists = await dbContext.Checklists
            .AsNoTracking()
            .OrderBy(checklist => checklist.Name)
            .ToListAsync();

        LogRetrievedAll(logger, checklists.Count);

        return Ok(checklists);
    }

    [HttpGet("{id:int}")]
    public async Task<ActionResult<Checklist>> GetById(int id)
    {
        LogRetrieving(logger, id);

        var checklist = await dbContext.Checklists
            .AsNoTracking()
            .FirstOrDefaultAsync(item => item.Id == id);

        if (checklist is null)
        {
            LogNotFound(logger, id);
        }

        return checklist is null ? (ActionResult<Checklist>)NotFound() : Ok(checklist);
    }

    [HttpPost]
    public async Task<ActionResult<Checklist>> Create([FromBody] ChecklistRequest request)
    {
        var trimmedName = request.Name.Trim();

        if (trimmedName.Length == 0)
        {
            ModelState.AddModelError(nameof(request.Name), "Checklist name is required.");
            return ValidationProblem(ModelState);
        }

        var duplicateName = await HasDuplicateNameAsync(trimmedName);

        if (duplicateName)
        {
            LogCreateDuplicateName(logger);
            return Conflict(new { message = "A checklist with this name already exists." });
        }

        var checklist = new Checklist
        {
            Name = trimmedName
        };

        dbContext.Checklists.Add(checklist);
        try
        {
            await dbContext.SaveChangesAsync();
        }
        catch (DbUpdateException)
        {
            var isDuplicateName = await HasDuplicateNameAsync(trimmedName);

            if (isDuplicateName)
            {
                LogCreateConcurrentDuplicateName(logger);
                return Conflict(new { message = "A checklist with this name already exists." });
            }

            throw;
        }

        LogCreated(logger, checklist.Id);

        return CreatedAtAction(nameof(GetById), new { id = checklist.Id }, checklist);
    }

    [HttpPut("{id:int}")]
    public async Task<ActionResult<Checklist>> Update(int id, [FromBody] ChecklistRequest request)
    {
        var checklist = await dbContext.Checklists.FirstOrDefaultAsync(item => item.Id == id);

        if (checklist is null)
        {
            LogNotFoundForUpdate(logger, id);
            return NotFound();
        }

        var trimmedName = request.Name.Trim();

        if (trimmedName.Length == 0)
        {
            ModelState.AddModelError(nameof(request.Name), "Checklist name is required.");
            return ValidationProblem(ModelState);
        }

        var duplicateName = await HasDuplicateNameAsync(trimmedName, id);

        if (duplicateName)
        {
            LogUpdateDuplicateName(logger, id);
            return Conflict(new { message = "A checklist with this name already exists." });
        }

        checklist.Name = trimmedName;

        try
        {
            await dbContext.SaveChangesAsync();
        }
        catch (DbUpdateException)
        {
            var isDuplicateName = await HasDuplicateNameAsync(trimmedName, id);

            if (isDuplicateName)
            {
                LogUpdateConcurrentDuplicateName(logger, id);
                return Conflict(new { message = "A checklist with this name already exists." });
            }

            throw;
        }

        LogUpdated(logger, id);

        return Ok(checklist);
    }

    private async Task<bool> HasDuplicateNameAsync(string name, int? excludeId = null)
    {
        var query = dbContext.Checklists.AsNoTracking();

        if (excludeId is int id)
        {
            query = query.Where(item => item.Id != id);
        }

        return dbContext.Database.IsSqlServer()
            ? await query.AnyAsync(item => item.Name == name)
            : await query.AnyAsync(item =>
                string.Equals(item.Name, name, StringComparison.OrdinalIgnoreCase));
    }

    [HttpDelete("{id:int}")]
    public async Task<IActionResult> Delete(int id)
    {
        var checklist = await dbContext.Checklists.FirstOrDefaultAsync(item => item.Id == id);

        if (checklist is null)
        {
            LogNotFoundForDeletion(logger, id);
            return NotFound();
        }

        dbContext.Checklists.Remove(checklist);
        await dbContext.SaveChangesAsync();

        LogDeleted(logger, id);

        return NoContent();
    }

    [LoggerMessage(Level = LogLevel.Information, Message = "Retrieving all checklists")]
    private static partial void LogRetrievingAll(ILogger logger);

    [LoggerMessage(Level = LogLevel.Information, Message = "Retrieved {Count} checklists")]
    private static partial void LogRetrievedAll(ILogger logger, int count);

    [LoggerMessage(Level = LogLevel.Information, Message = "Retrieving checklist {ChecklistId}")]
    private static partial void LogRetrieving(ILogger logger, int checklistId);

    [LoggerMessage(Level = LogLevel.Warning, Message = "Checklist {ChecklistId} not found")]
    private static partial void LogNotFound(ILogger logger, int checklistId);

    [LoggerMessage(Level = LogLevel.Warning, Message = "Checklist creation failed due to duplicate name")]
    private static partial void LogCreateDuplicateName(ILogger logger);

    [LoggerMessage(Level = LogLevel.Warning, Message = "Checklist creation failed due to concurrent duplicate name")]
    private static partial void LogCreateConcurrentDuplicateName(ILogger logger);

    [LoggerMessage(Level = LogLevel.Information, Message = "Created checklist {ChecklistId}")]
    private static partial void LogCreated(ILogger logger, int checklistId);

    [LoggerMessage(Level = LogLevel.Warning, Message = "Checklist {ChecklistId} not found for update")]
    private static partial void LogNotFoundForUpdate(ILogger logger, int checklistId);

    [LoggerMessage(Level = LogLevel.Warning, Message = "Checklist {ChecklistId} update failed due to duplicate name")]
    private static partial void LogUpdateDuplicateName(ILogger logger, int checklistId);

    [LoggerMessage(Level = LogLevel.Warning, Message = "Checklist {ChecklistId} update failed due to concurrent duplicate name")]
    private static partial void LogUpdateConcurrentDuplicateName(ILogger logger, int checklistId);

    [LoggerMessage(Level = LogLevel.Information, Message = "Updated checklist {ChecklistId}")]
    private static partial void LogUpdated(ILogger logger, int checklistId);

    [LoggerMessage(Level = LogLevel.Warning, Message = "Checklist {ChecklistId} not found for deletion")]
    private static partial void LogNotFoundForDeletion(ILogger logger, int checklistId);

    [LoggerMessage(Level = LogLevel.Information, Message = "Deleted checklist {ChecklistId}")]
    private static partial void LogDeleted(ILogger logger, int checklistId);
}
