namespace CheckMate.Api.Models;

public class ChecklistRun
{
    public int Id { get; set; }

    /// <summary>
    /// The key the device that started the run gave it, so a sync of the same run finds it again. Unique among a
    /// user's runs.
    /// </summary>
    public Guid ClientKey { get; set; }

    public int ChecklistId { get; set; }

    // Always the checklist's user. The run keeps its own copy so it can be looked up by its ID alone.
    public int UserId { get; set; }

    public DateTimeOffset StartedAt { get; set; }

    public DateTimeOffset? CompletedAt { get; set; }

    public List<ChecklistRunStep> Steps { get; set; } = [];
}
