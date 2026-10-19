namespace CheckMate.Api.Models;

/// <summary>A whole checklist read from a file by <see cref="ChecklistFile.Read"/>, not yet checked or saved.</summary>
public class ChecklistImport
{
    public string Name { get; set; } = string.Empty;

    /// <summary>The steps in the order to list them.</summary>
    public IReadOnlyList<ChecklistImportStep> Steps { get; set; } = [];
}

public class ChecklistImportStep
{
    /// <summary>
    /// The file's own name for the step, so other steps can depend on it. It isn't saved, and is optional for a step
    /// nothing depends on.
    /// </summary>
    public string? Id { get; set; }

    public string Text { get; set; } = string.Empty;

    public StepType Type { get; set; } = StepType.Checkbox;

    /// <summary>A choice step's options in the order to list them. Other types have none.</summary>
    public IReadOnlyList<string>? Options { get; set; }

    /// <summary>The <see cref="Id"/>s of the other steps that must be done before this one.</summary>
    public IReadOnlyList<string>? DependsOn { get; set; }
}
