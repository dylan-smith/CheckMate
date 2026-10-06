using CheckMate.Api.Models;

namespace CheckMate.Api.Contracts;

public record ChecklistStepResponse(int Id, string Text, int SortOrder)
{
    public static ChecklistStepResponse From(ChecklistStep step)
    {
        return new(step.Id, step.Text, step.SortOrder);
    }
}
