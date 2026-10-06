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
public class ChecklistsController(ChecklistDbContext dbContext, ILogger<ChecklistsController> logger) : ControllerBase
{
    [HttpGet]
    public async Task<ActionResult<IEnumerable<Checklist>>> GetAll()
    {
        logger.LogInformation("Retrieving all checklists");

        var checklists = await dbContext.Checklists
            .AsNoTracking()
            .OrderBy(checklist => checklist.Name)
            .ToListAsync();

        logger.LogInformation("Retrieved {Count} checklists", checklists.Count);

        return Ok(checklists);
    }

    [HttpGet("{id:int}")]
    public async Task<ActionResult<Checklist>> GetById(int id)
    {
        logger.LogInformation("Retrieving checklist {ChecklistId}", id);

        var checklist = await dbContext.Checklists
            .AsNoTracking()
            .FirstOrDefaultAsync(item => item.Id == id);

        if (checklist is null)
        {
            logger.LogWarning("Checklist {ChecklistId} not found", id);
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
            logger.LogWarning("Checklist creation failed due to duplicate name");
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
                logger.LogWarning("Checklist creation failed due to concurrent duplicate name");
                return Conflict(new { message = "A checklist with this name already exists." });
            }

            throw;
        }

        logger.LogInformation("Created checklist {ChecklistId}", checklist.Id);

        return CreatedAtAction(nameof(GetById), new { id = checklist.Id }, checklist);
    }

    [HttpPut("{id:int}")]
    public async Task<ActionResult<Checklist>> Update(int id, [FromBody] ChecklistRequest request)
    {
        var checklist = await dbContext.Checklists.FirstOrDefaultAsync(item => item.Id == id);

        if (checklist is null)
        {
            logger.LogWarning("Checklist {ChecklistId} not found for update", id);
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
            logger.LogWarning("Checklist {ChecklistId} update failed due to duplicate name", id);
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
                logger.LogWarning("Checklist {ChecklistId} update failed due to concurrent duplicate name", id);
                return Conflict(new { message = "A checklist with this name already exists." });
            }

            throw;
        }

        logger.LogInformation("Updated checklist {ChecklistId}", id);

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
            logger.LogWarning("Checklist {ChecklistId} not found for deletion", id);
            return NotFound();
        }

        dbContext.Checklists.Remove(checklist);
        await dbContext.SaveChangesAsync();

        logger.LogInformation("Deleted checklist {ChecklistId}", id);

        return NoContent();
    }
}
