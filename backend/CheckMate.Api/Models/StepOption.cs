using System.ComponentModel.DataAnnotations;

namespace CheckMate.Api.Models;

/// <summary>One of the options a choice step offers.</summary>
public class StepOption
{
    public int Id { get; set; }

    public int StepId { get; set; }

    [Required]
    [MaxLength(200)]
    public string Text { get; set; } = string.Empty;

    public int SortOrder { get; set; }
}
