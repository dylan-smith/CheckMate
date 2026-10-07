using CheckMate.Api.Models;

namespace CheckMate.Api.Contracts;

public record ChecklistRunStepResponse(
    int? StepId,
    string Text,
    StepType Type,
    bool IsDone,
    DateTimeOffset? CompletedAt,
    string? ResponseText,
    decimal? ResponseNumber)
{
    public static ChecklistRunStepResponse From(RunStepResponse response)
    {
        return new(
            response.StepId,
            response.StepText,
            response.StepType,
            response.IsDone,
            response.CompletedAt,
            response.ResponseText,
            response.ResponseNumber);
    }
}
