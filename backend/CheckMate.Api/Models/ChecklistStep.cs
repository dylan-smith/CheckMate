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
}
