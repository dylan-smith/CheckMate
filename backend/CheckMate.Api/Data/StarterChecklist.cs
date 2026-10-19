using CheckMate.Api.Models;

namespace CheckMate.Api.Data;

/// <summary>
/// The checklist a new user starts with, so they have an example rather than an empty list. It's StarterChecklist.yml,
/// a checklist file like an export, built into the API.
/// </summary>
public static class StarterChecklist
{
    // The LogicalName CheckMate.Api.csproj gives the embedded file.
    private const string ResourceName = "StarterChecklist.yml";

    /// <summary>Reads the starter checklist's file.</summary>
    public static string ReadFile()
    {
        using var stream = typeof(StarterChecklist).Assembly.GetManifestResourceStream(ResourceName)
            ?? throw new InvalidOperationException($"The {ResourceName} resource is missing.");
        using var reader = new StreamReader(stream);
        return reader.ReadToEnd();
    }

    /// <summary>
    /// Adds the starter checklist and its steps to the context, for the current user once it's saved.
    /// </summary>
    public static Checklist AddTo(ChecklistDbContext dbContext)
    {
        ArgumentNullException.ThrowIfNull(dbContext);

        var file = ChecklistFile.Read(ReadFile());
        var errors = new List<string>();
        var steps = ChecklistImportRules.BuildSteps(file.Steps, errors)
            ?? throw new InvalidOperationException($"{ResourceName} isn't a valid checklist: {string.Join(" ", errors)}");
        var checklist = new Checklist { Name = file.Name.Trim() };

        foreach (var step in steps)
        {
            step.Checklist = checklist;
        }

        dbContext.Checklists.Add(checklist);
        dbContext.ChecklistSteps.AddRange(steps);
        return checklist;
    }
}
