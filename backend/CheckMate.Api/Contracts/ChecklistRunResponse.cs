namespace CheckMate.Api.Contracts;

public record ChecklistRunResponse(
    int Id,
    int ChecklistId,
    string ChecklistName,
    DateTimeOffset StartedAt,
    DateTimeOffset? CompletedAt,
    IReadOnlyList<ChecklistRunStepResponse> Steps);
