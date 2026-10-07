using CheckMate.Api.Models;

namespace CheckMate.Api.Contracts;

public record ChecklistRunStepResponse(int? StepId, string Text, bool IsDone, DateTimeOffset? CompletedAt)
{
    public static ChecklistRunStepResponse From(ChecklistRunStep step)
    {
        return new(step.StepId, step.StepText, step.IsDone, step.CompletedAt);
    }
}
