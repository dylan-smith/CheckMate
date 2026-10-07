using System.ComponentModel.DataAnnotations;

namespace CheckMate.Api.Contracts;

/// <summary>A response to one step of a run. Which field is used depends on the step's type.</summary>
public class RunStepRequest
{
    /// <summary>Whether a checkbox step is ticked.</summary>
    public bool IsDone { get; set; }

    /// <summary>The value of a text step. It's done when this isn't empty.</summary>
    [MaxLength(1000)]
    public string? Text { get; set; }

    /// <summary>The value of a number step. It's done when this isn't null.</summary>
    public decimal? Number { get; set; }
}
