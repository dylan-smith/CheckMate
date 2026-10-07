namespace CheckMate.Api.Models;

public class ChecklistRun
{
    public int Id { get; set; }

    public int ChecklistId { get; set; }

    public DateTimeOffset StartedAt { get; set; }

    public DateTimeOffset? CompletedAt { get; set; }

    public List<RunStepResponse> Responses { get; set; } = [];
}
