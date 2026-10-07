using CheckMate.Api.Models;

namespace CheckMate.Api.Contracts;

public record StepOptionResponse(int Id, string Text)
{
    /// <summary>The options in the order they're listed.</summary>
    public static IReadOnlyList<StepOptionResponse> FromAll(IEnumerable<StepOption> options)
    {
        return options
            .OrderBy(option => option.SortOrder)
            .ThenBy(option => option.Id)
            .Select(option => new StepOptionResponse(option.Id, option.Text))
            .ToList();
    }
}
