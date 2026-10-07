using System.ComponentModel.DataAnnotations;

namespace CheckMate.Api.Contracts;

public class ChecklistStepOrderRequest
{
    /// <summary>Every step ID of the checklist, each once, in the new order.</summary>
    [Required]
    public IReadOnlyList<int> StepIds { get; set; } = [];
}
