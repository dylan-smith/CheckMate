using CheckMate.Api.Models;

namespace CheckMate.Api.Contracts;

/// <param name="Options">
/// The options a choice step offers now, which can be picked while the run is open. They're the step's current
/// options, so they're empty once the step is deleted; <paramref name="SelectedOptionText"/> keeps what was picked.
/// </param>
/// <param name="DependsOnStepIds">
/// The steps of the run that must be done before this one. Like the options, they're the step's current
/// prerequisites, leaving out any added to the checklist after the run started.
/// </param>
/// <param name="IsLocked">Whether one of those steps isn't done yet, so this one can't be filled in.</param>
public record ChecklistRunStepResponse(
    int? StepId,
    string Text,
    StepType Type,
    bool IsDone,
    DateTimeOffset? CompletedAt,
    string? ResponseText,
    decimal? ResponseNumber,
    IReadOnlyList<StepOptionResponse> Options,
    int? SelectedOptionId,
    string? SelectedOptionText,
    IReadOnlyList<int> DependsOnStepIds,
    bool IsLocked)
{
    public static ChecklistRunStepResponse From(
        ChecklistRunStep step,
        IEnumerable<StepOption> options,
        IEnumerable<int> dependsOnStepIds,
        bool isLocked)
    {
        var optionResponses = StepOptionResponse.FromAll(options);

        // The run step and the options are read separately, so an option removed in between can still be picked
        // here. It's sent as removed (a null ID with its text kept), like one removed earlier.
        var selectedOptionId = optionResponses.Any(option => option.Id == step.SelectedOptionId)
            ? step.SelectedOptionId
            : null;

        return new(
            step.StepId,
            step.StepText,
            step.StepType,
            step.IsDone,
            step.CompletedAt,
            step.ResponseText,
            step.ResponseNumber,
            optionResponses,
            selectedOptionId,
            step.SelectedOptionText,
            [.. dependsOnStepIds.Order()],
            isLocked);
    }
}
