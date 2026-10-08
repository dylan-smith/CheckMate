using System.ComponentModel.DataAnnotations;

namespace CheckMate.Api.Contracts;

/// <summary>
/// A whole run as the device filling it out has it. A device can fill out a checklist with no connection and send the
/// run once it has one, so the times are the device's rather than the server's.
/// </summary>
public class RunSyncRequest
{
    [Required]
    public DateTimeOffset? StartedAt { get; set; }

    /// <summary>When the device completed the run, or null while it's still open.</summary>
    public DateTimeOffset? CompletedAt { get; set; }

    /// <summary>The steps as the device shows them, in order, with each checklist step at most once.</summary>
    [Required]
    public IReadOnlyList<RunSyncStepRequest> Steps { get; set; } = [];
}
