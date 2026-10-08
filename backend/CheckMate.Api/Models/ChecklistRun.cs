namespace CheckMate.Api.Models;

public class ChecklistRun
{
    public int Id { get; set; }

    public int ChecklistId { get; set; }

    // Always the checklist's user. The run keeps its own copy so it can be looked up by its ID alone.
    public int UserId { get; set; }

    public DateTimeOffset StartedAt { get; set; }

    public DateTimeOffset? CompletedAt { get; set; }

    public List<ChecklistRunStep> Steps { get; set; } = [];
}
