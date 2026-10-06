using System.ComponentModel.DataAnnotations;

namespace CheckMate.Api.Contracts;

public class ChecklistStepRequest
{
    [Required]
    [MaxLength(500)]
    public string Text { get; set; } = string.Empty;
}
