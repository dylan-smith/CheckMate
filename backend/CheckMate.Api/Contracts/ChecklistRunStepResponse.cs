using CheckMate.Api.Models;

namespace CheckMate.Api.Contracts;

public record ChecklistRunStepResponse(
    int? StepId,
    string Text,
    StepType Type,
    bool IsDone,
    DateTimeOffset? CompletedAt,
    string? ResponseText)
{
    public static ChecklistRunStepResponse From(ChecklistRunStep step)
    {
        return new(
            step.StepId,
            step.StepText,
            step.StepType,
            step.IsDone,
            step.CompletedAt,
            step.ResponseText);
    }
}
