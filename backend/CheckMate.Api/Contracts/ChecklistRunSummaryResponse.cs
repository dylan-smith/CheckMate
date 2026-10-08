namespace CheckMate.Api.Contracts;

public record ChecklistRunSummaryResponse(
    int Id,
    DateTimeOffset StartedAt,
    DateTimeOffset? CompletedAt);
