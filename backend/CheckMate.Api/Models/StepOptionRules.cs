namespace CheckMate.Api.Models;

public static class StepOptionRules
{
    public const int MinChoiceOptions = 2;

    /// <summary>
    /// Checks a step's option texts suit its type: only choice steps have options, and a choice step needs at least
    /// <see cref="MinChoiceOptions"/> of them, none empty and all different. Texts are compared trimmed.
    /// </summary>
    /// <returns>A message for the caller when they aren't valid, or null when they are.</returns>
    public static string? Validate(StepType type, IReadOnlyList<string> texts)
    {
        ArgumentNullException.ThrowIfNull(texts);

        if (type != StepType.Choice)
        {
            return texts.Count > 0 ? "Only choice steps have options." : null;
        }

        var trimmed = texts.Select(text => text.Trim()).ToList();

        return trimmed switch
        {
            { Count: < MinChoiceOptions } => $"A choice step needs at least {MinChoiceOptions} options.",
            _ when trimmed.Any(text => text.Length == 0) => "Option text is required.",
            _ when trimmed.Distinct(StringComparer.OrdinalIgnoreCase).Count() != trimmed.Count => "Each option must be different.",
            _ => null
        };
    }
}
