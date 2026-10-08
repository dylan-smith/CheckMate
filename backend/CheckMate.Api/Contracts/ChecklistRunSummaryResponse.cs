namespace CheckMate.Api.Contracts;

public record ChecklistRunSummaryResponse(
    int Id,
    Guid ClientKey,
    DateTimeOffset StartedAt,
    DateTimeOffset? CompletedAt);
