using CheckMate.Api.Models;

namespace CheckMate.Api.Contracts;

/// <param name="Options">
/// The options a choice step offers now, which can be picked while the run is open. They're the step's current
/// options, so they're empty once the step is deleted; <paramref name="SelectedOptionText"/> keeps what was picked.
/// </param>
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
    string? SelectedOptionText)
{
    public static ChecklistRunStepResponse From(ChecklistRunStep step, IEnumerable<StepOption> options)
    {
        return new(
            step.StepId,
            step.StepText,
            step.StepType,
            step.IsDone,
            step.CompletedAt,
            step.ResponseText,
            step.ResponseNumber,
            StepOptionResponse.FromAll(options),
            step.SelectedOptionId,
            step.SelectedOptionText);
    }
}
