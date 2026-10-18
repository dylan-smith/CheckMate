using System.ComponentModel.DataAnnotations;
using CheckMate.Api.Models;

namespace CheckMate.Api.Contracts;

/// <summary>A whole checklist to create at once, as read from an exported file.</summary>
public class ChecklistImportRequest
{
    [Required]
    [MaxLength(200)]
    public string Name { get; set; } = string.Empty;

    /// <summary>The steps in the order to list them.</summary>
    [Required]
    [MaxLength(500)]
    public IReadOnlyList<ChecklistImportStep> Steps { get; set; } = [];
}

public class ChecklistImportStep
{
    /// <summary>
    /// The file's own name for the step, so other steps can depend on it. It isn't saved, and is optional for a step
    /// nothing depends on.
    /// </summary>
    [MaxLength(100)]
    public string? Id { get; set; }

    [Required]
    [MaxLength(500)]
    public string Text { get; set; } = string.Empty;

    [EnumDataType(typeof(StepType))]
    public StepType Type { get; set; } = StepType.Checkbox;

    /// <summary>A choice step's options in the order to list them. Other types have none.</summary>
    [MaxLength(50)]
    public IReadOnlyList<string>? Options { get; set; }

    /// <summary>The <see cref="Id"/>s of the other steps that must be done before this one.</summary>
    public IReadOnlyList<string>? DependsOn { get; set; }
}
