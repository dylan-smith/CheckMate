namespace CheckMate.Api.Contracts;

/// <param name="ClientKey">The key the device that started the run gave it, which a sync of the run is sent under.</param>
public record ChecklistRunResponse(
    int Id,
    Guid ClientKey,
    int ChecklistId,
    string ChecklistName,
    DateTimeOffset StartedAt,
    DateTimeOffset? CompletedAt,
    IReadOnlyList<ChecklistRunStepResponse> Steps);
