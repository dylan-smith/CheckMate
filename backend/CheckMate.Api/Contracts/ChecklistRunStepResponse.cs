using CheckMate.Api.Models;

namespace CheckMate.Api.Contracts;

public record ChecklistRunStepResponse(int? StepId, string Text, bool IsDone, DateTimeOffset? CompletedAt)
{
    public static ChecklistRunStepResponse From(RunStepResponse response)
    {
        return new(response.StepId, response.StepText, response.IsDone, response.CompletedAt);
    }
}
