using System.ComponentModel.DataAnnotations;

namespace CheckMate.Api.Models;

public class RunStepResponse
{
    public int Id { get; set; }

    public int RunId { get; set; }

    /// <summary>The step this response is for, or null once that step has been deleted.</summary>
    public int? StepId { get; set; }

    /// <summary>The step's text when the run started, so later edits don't change past runs.</summary>
    [Required]
    [MaxLength(500)]
    public string StepText { get; set; } = string.Empty;

    /// <summary>The step's type when the run started.</summary>
    public StepType StepType { get; set; }

    public int SortOrder { get; set; }

    public bool IsDone { get; set; }

    public DateTimeOffset? CompletedAt { get; set; }

    /// <summary>The value entered for a text step, or null when there isn't one.</summary>
    [MaxLength(1000)]
    public string? ResponseText { get; set; }

    /// <summary>The value entered for a number step, or null when there isn't one.</summary>
    public decimal? ResponseNumber { get; set; }
}
