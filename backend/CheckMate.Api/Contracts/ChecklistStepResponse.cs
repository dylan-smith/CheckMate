using CheckMate.Api.Models;

namespace CheckMate.Api.Contracts;

public record ChecklistStepResponse(
    int Id,
    string Text,
    StepType Type,
    int SortOrder,
    IReadOnlyList<StepOptionResponse> Options,
    IReadOnlyList<int> DependsOnStepIds)
{
    /// <summary>Needs the step's options and <see cref="ChecklistStep.DependsOn"/> loaded.</summary>
    public static ChecklistStepResponse From(ChecklistStep step)
    {
        return new(
            step.Id,
            step.Text,
            step.Type,
            step.SortOrder,
            StepOptionResponse.FromAll(step.Options),
            [.. step.DependsOn.Select(dependency => dependency.DependsOnStepId).Order()]);
    }
}
