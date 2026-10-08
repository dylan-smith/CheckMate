using System.ComponentModel.DataAnnotations;
using CheckMate.Api.Models;

namespace CheckMate.Api.Contracts;

/// <summary>
/// One step of a synced run, in the shape <see cref="ChecklistRunStepResponse"/> sends it, so a device sends back
/// what it shows. Which response field is used depends on the step's type, as in <see cref="RunStepRequest"/>.
/// </summary>
public class RunSyncStepRequest
{
    public int StepId { get; set; }

    /// <summary>The step's text as the device showed it, which becomes the run's copy when the run is first synced.</summary>
    [Required]
    [MaxLength(500)]
    public string Text { get; set; } = string.Empty;

    /// <summary>The step's type as the device showed it, kept like the text.</summary>
    [EnumDataType(typeof(StepType))]
    public StepType Type { get; set; }

    /// <summary>Whether a checkbox step is ticked. Other types are done when they have a value.</summary>
    public bool IsDone { get; set; }

    /// <summary>When the device marked the step done. Null on a done step means when it was synced.</summary>
    public DateTimeOffset? CompletedAt { get; set; }

    [MaxLength(1000)]
    public string? ResponseText { get; set; }

    public decimal? ResponseNumber { get; set; }

    public int? SelectedOptionId { get; set; }

    /// <summary>
    /// The picked option's text as the device showed it. It's what's kept when the option is no longer on the step.
    /// </summary>
    [MaxLength(200)]
    public string? SelectedOptionText { get; set; }
}
