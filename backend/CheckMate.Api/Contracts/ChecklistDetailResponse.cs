namespace CheckMate.Api.Contracts;

public record ChecklistDetailResponse(int Id, string Name, IReadOnlyList<ChecklistStepResponse> Steps);
