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
}
