using System.ComponentModel.DataAnnotations;

namespace CheckMate.Api.Models;

public class ChecklistStep
{
    public int Id { get; set; }

    public int ChecklistId { get; set; }

    [Required]
    [MaxLength(500)]
    public string Text { get; set; } = string.Empty;

    public StepType Type { get; set; }

    public int SortOrder { get; set; }

    /// <summary>The options of a choice step. Other types have none.</summary>
    public List<StepOption> Options { get; set; } = [];

    /// <summary>The steps of the same checklist that must be done before this one.</summary>
    public List<StepDependency> DependsOn { get; set; } = [];
}
