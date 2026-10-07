using CheckMate.Api.Models;

namespace CheckMate.Api.Contracts;

public record ChecklistStepResponse(int Id, string Text, StepType Type, int SortOrder, IReadOnlyList<int> DependsOnStepIds)
{
    /// <summary>Maps a step whose <see cref="ChecklistStep.DependsOn"/> has been loaded.</summary>
    public static ChecklistStepResponse From(ChecklistStep step)
    {
        return new(step.Id, step.Text, step.Type, step.SortOrder, [.. step.DependsOn.Select(dependency => dependency.DependsOnStepId).Order()]);
    }
}
