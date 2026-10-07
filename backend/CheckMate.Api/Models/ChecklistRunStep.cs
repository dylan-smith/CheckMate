using System.ComponentModel.DataAnnotations;

namespace CheckMate.Api.Models;

public class ChecklistRunStep
{
    public int Id { get; set; }

    public int RunId { get; set; }

    /// <summary>The checklist step this was copied from, or null once that step has been deleted.</summary>
    public int? StepId { get; set; }

    /// <summary>The step's text when the run started, so later edits don't change past runs.</summary>
    [Required]
    [MaxLength(500)]
    public string StepText { get; set; } = string.Empty;

    public int SortOrder { get; set; }

    public bool IsDone { get; set; }

    public DateTimeOffset? CompletedAt { get; set; }
}
