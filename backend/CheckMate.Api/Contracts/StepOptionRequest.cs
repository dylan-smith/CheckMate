using System.ComponentModel.DataAnnotations;

namespace CheckMate.Api.Contracts;

public class StepOptionRequest
{
    /// <summary>The ID of an option the step already has, to keep it, or null for a new option.</summary>
    public int? Id { get; set; }

    [Required]
    [MaxLength(200)]
    public string Text { get; set; } = string.Empty;
}
