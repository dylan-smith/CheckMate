using System.ComponentModel.DataAnnotations;
using CheckMate.Api.Models;

namespace CheckMate.Api.Contracts;

public class ChecklistStepRequest
{
    [Required]
    [MaxLength(500)]
    public string Text { get; set; } = string.Empty;

    [EnumDataType(typeof(StepType))]
    public StepType Type { get; set; } = StepType.Checkbox;

    /// <summary>
    /// A choice step's options in the order to list them, which replace the ones it had. Other types have none.
    /// </summary>
    [MaxLength(50)]
    public IReadOnlyList<StepOptionRequest>? Options { get; set; }

    /// <summary>
    /// The other steps of the checklist that must be done before this one. Null leaves an existing step's
    /// prerequisites as they are, and gives a new step none.
    /// </summary>
    public IReadOnlyList<int>? DependsOnStepIds { get; set; }
}
