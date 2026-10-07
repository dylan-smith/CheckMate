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
}
