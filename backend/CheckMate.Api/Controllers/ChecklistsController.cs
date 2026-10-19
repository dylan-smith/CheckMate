using System.Text;
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
    private const int MaxNameLength = 200;

    // Limits on an imported checklist file, matching what the step endpoints allow (see ChecklistStepRequest).
    private const int MaxImportBytes = 1024 * 1024;
    private const int MaxImportSteps = 500;
    private const int MaxStepTextLength = 500;
    private const int MaxStepIdLength = 100;
    private const int MaxOptions = 50;
    private const int MaxOptionTextLength = 200;

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
    public async Task<ActionResult<ChecklistDetailResponse>> GetById(int id)
    {
        logger.LogInformation("Retrieving checklist {ChecklistId}", id);

        var checklist = await dbContext.Checklists
            .AsNoTracking()
            .FirstOrDefaultAsync(item => item.Id == id);

        if (checklist is null)
        {
            logger.LogWarning("Checklist {ChecklistId} not found", id);
            return NotFound();
        }

        var steps = await LoadStepsAsync(id);

        return Ok(new ChecklistDetailResponse(
            checklist.Id,
            checklist.Name,
            [.. steps.Select(ChecklistStepResponse.From)]));
    }

    /// <summary>
    /// Downloads the checklist as a YAML file to share or keep, which <see cref="Import"/> reads back. Fill-outs
    /// aren't part of it.
    /// </summary>
    [HttpGet("{id:int}/export")]
    public async Task<IActionResult> Export(int id)
    {
        var checklist = await dbContext.Checklists
            .AsNoTracking()
            .FirstOrDefaultAsync(item => item.Id == id);

        if (checklist is null)
        {
            logger.LogWarning("Checklist {ChecklistId} not found for export", id);
            return NotFound();
        }

        var steps = await LoadStepsAsync(id);

        logger.LogInformation("Exported checklist {ChecklistId}", id);

        return File(
            Encoding.UTF8.GetBytes(ChecklistFile.Write(checklist.Name, steps)),
            ChecklistFile.ContentType,
            ChecklistFile.FileName(checklist.Name));
    }

    // The checklist's steps in order, with their options and prerequisites.
    private Task<List<ChecklistStep>> LoadStepsAsync(int checklistId)
    {
        return dbContext.ChecklistSteps
            .AsNoTracking()
            .Include(step => step.Options)
            .Include(step => step.DependsOn)
            .Where(step => step.ChecklistId == checklistId)
            .OrderBy(step => step.SortOrder)
            .ThenBy(step => step.Id)
            .ToListAsync();
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

    /// <summary>
    /// Creates a checklist with all its steps at once, from a YAML file made by <see cref="Export"/> or written by
    /// hand, sent as the request body. A name already in use gets a number added, like "Daily (2)", so the response
    /// has the name it was saved with.
    /// </summary>
    [HttpPost("import")]
    [Consumes(ChecklistFile.ContentType, "text/yaml", "text/plain")]
    [RequestSizeLimit(MaxImportBytes)]
    public async Task<ActionResult<ChecklistDetailResponse>> Import()
    {
        using var reader = new StreamReader(Request.Body, Encoding.UTF8);
        var text = await reader.ReadToEndAsync(HttpContext.RequestAborted);
        ChecklistImport file;

        try
        {
            file = ChecklistFile.Read(text);
        }
        catch (ChecklistFileException exception)
        {
            logger.LogWarning("Rejected a checklist file that couldn't be read");
            ModelState.AddModelError("File", exception.Message);
            return ValidationProblem(ModelState);
        }

        var trimmedName = file.Name.Trim();

        if (trimmedName.Length > MaxNameLength)
        {
            ModelState.AddModelError(nameof(file.Name), $"The checklist name can be at most {MaxNameLength} characters.");
            return ValidationProblem(ModelState);
        }

        if (BuildImportedSteps(file.Steps) is not { } steps)
        {
            logger.LogWarning("Rejected a checklist import");
            return ValidationProblem(ModelState);
        }

        var checklist = new Checklist { Name = await UnusedNameAsync(trimmedName) };

        foreach (var step in steps)
        {
            step.Checklist = checklist;
        }

        dbContext.Checklists.Add(checklist);
        dbContext.ChecklistSteps.AddRange(steps);

        try
        {
            await dbContext.SaveChangesAsync();
        }
        catch (DbUpdateException)
        {
            if (await HasDuplicateNameAsync(checklist.Name))
            {
                logger.LogWarning("Checklist import failed due to concurrent duplicate name");
                return Conflict(new { message = "A checklist with this name was just created. Try importing again." });
            }

            throw;
        }

        logger.LogInformation("Imported checklist {ChecklistId} with {StepCount} steps", checklist.Id, steps.Count);

        return CreatedAtAction(
            nameof(GetById),
            new { id = checklist.Id },
            new ChecklistDetailResponse(checklist.Id, checklist.Name, [.. steps.Select(ChecklistStepResponse.From)]));
    }

    // Checks the imported steps and makes them, with their options and prerequisites, or adds the problems to
    // ModelState and returns null. Prerequisites name other steps by the file's own IDs.
    private List<ChecklistStep>? BuildImportedSteps(IReadOnlyList<ChecklistImportStep> requested)
    {
        var steps = new List<ChecklistStep>();
        var indexById = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);

        if (requested.Count > MaxImportSteps)
        {
            ModelState.AddModelError(nameof(ChecklistImport.Steps), $"A checklist file can have at most {MaxImportSteps} steps.");
            return null;
        }

        for (var index = 0; index < requested.Count; index++)
        {
            var item = requested[index];
            var prefix = $"Step {index + 1}: ";
            var text = item.Text.Trim();
            var options = item.Options ?? [];

            if (text.Length == 0)
            {
                ModelState.AddModelError(nameof(ChecklistImport.Steps), prefix + "Step text is required.");
            }
            else if (text.Length > MaxStepTextLength)
            {
                ModelState.AddModelError(nameof(ChecklistImport.Steps), prefix + $"Step text can be at most {MaxStepTextLength} characters.");
            }
            else if (options.Count > MaxOptions)
            {
                ModelState.AddModelError(nameof(ChecklistImport.Steps), prefix + $"A step can have at most {MaxOptions} options.");
            }
            else if (StepOptionRules.Validate(item.Type, options) is { } optionError)
            {
                ModelState.AddModelError(nameof(ChecklistImport.Steps), prefix + optionError);
            }
            else if (options.Any(option => option.Trim().Length > MaxOptionTextLength))
            {
                ModelState.AddModelError(nameof(ChecklistImport.Steps), prefix + $"Option text can be at most {MaxOptionTextLength} characters.");
            }

            if (item.Id is not null)
            {
                var id = item.Id.Trim();

                if (id.Length == 0)
                {
                    ModelState.AddModelError(nameof(ChecklistImport.Steps), prefix + "A step's id can't be empty.");
                }
                else if (id.Length > MaxStepIdLength)
                {
                    ModelState.AddModelError(nameof(ChecklistImport.Steps), prefix + $"A step's id can be at most {MaxStepIdLength} characters.");
                }
                else if (!indexById.TryAdd(id, index))
                {
                    ModelState.AddModelError(nameof(ChecklistImport.Steps), prefix + $"Another step already has the id '{id}'.");
                }
            }

            steps.Add(new ChecklistStep
            {
                Text = text,
                Type = item.Type,
                SortOrder = index,
                Options = [.. options.Select((option, optionIndex) => new StepOption { Text = option.Trim(), SortOrder = optionIndex })]
            });
        }

        if (!ModelState.IsValid)
        {
            return null;
        }

        var graph = new Dictionary<int, IReadOnlyCollection<int>>();

        for (var index = 0; index < requested.Count; index++)
        {
            var prerequisites = new HashSet<int>();

            foreach (var id in (requested[index].DependsOn ?? []).Select(dependsOn => dependsOn.Trim()))
            {
                if (!indexById.TryGetValue(id, out var prerequisite))
                {
                    ModelState.AddModelError(nameof(ChecklistImport.Steps), $"Step {index + 1} depends on '{id}', which isn't the id of any step.");
                }
                else if (prerequisite == index)
                {
                    ModelState.AddModelError(nameof(ChecklistImport.Steps), $"Step {index + 1}: A step can't depend on itself.");
                }
                else
                {
                    prerequisites.Add(prerequisite);
                }
            }

            graph[index] = prerequisites;
        }

        if (!ModelState.IsValid)
        {
            return null;
        }

        // A step is in a loop when one of its prerequisites leads back to it.
        foreach (var (index, prerequisites) in graph)
        {
            foreach (var prerequisite in prerequisites)
            {
                if (StepDependencyGraph.FindPath(graph, prerequisite, index) is { } path)
                {
                    var loop = path.Prepend(index).Select(stepIndex => $"\"{steps[stepIndex].Text}\"");
                    ModelState.AddModelError(
                        nameof(ChecklistImport.Steps),
                        $"Steps can't depend on each other in a loop: {string.Join(" depends on ", loop)}.");
                    return null;
                }
            }
        }

        for (var index = 0; index < steps.Count; index++)
        {
            steps[index].DependsOn = [.. graph[index].Order().Select(prerequisite => new StepDependency { DependsOnStep = steps[prerequisite] })];
        }

        return steps;
    }

    // The name, or the first of "Name (2)", "Name (3)" and so on that the user doesn't already have, shortening the
    // name if it has to so the number still fits.
    private async Task<string> UnusedNameAsync(string name)
    {
        if (!await HasDuplicateNameAsync(name))
        {
            return name;
        }

        var existing = (await dbContext.Checklists.AsNoTracking().Select(item => item.Name).ToListAsync())
            .ToHashSet(StringComparer.OrdinalIgnoreCase);

        for (var number = 2; ; number++)
        {
            var suffix = $" ({number})";
            var candidate = (name.Length + suffix.Length > MaxNameLength
                ? name[..(MaxNameLength - suffix.Length)].TrimEnd()
                : name) + suffix;

            if (!existing.Contains(candidate))
            {
                return candidate;
            }
        }
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

        // SQL Server cascades the delete to the steps, their options and prerequisites, and the runs through the foreign
        // keys, but the in-memory provider only cascades to tracked entities, so load them first there.
        if (!dbContext.Database.IsRelational())
        {
            await dbContext.ChecklistSteps
                .Where(step => step.ChecklistId == id)
                .Include(step => step.Options)
                .Include(step => step.DependsOn)
                .LoadAsync();
            await dbContext.ChecklistRuns.Where(run => run.ChecklistId == id).Include(run => run.Steps).LoadAsync();
        }

        dbContext.Checklists.Remove(checklist);
        await dbContext.SaveChangesAsync();

        logger.LogInformation("Deleted checklist {ChecklistId}", id);

        return NoContent();
    }
}
