using CheckMate.Api.Models;

namespace CheckMate.Api.Contracts;

public record ChecklistStepResponse(
    int Id,
    string Text,
    StepType Type,
    int SortOrder,
    IReadOnlyList<StepOptionResponse> Options)
{
    /// <summary>Needs the step's options loaded.</summary>
    public static ChecklistStepResponse From(ChecklistStep step)
    {
        return new(step.Id, step.Text, step.Type, step.SortOrder, StepOptionResponse.FromAll(step.Options));
    }
}
