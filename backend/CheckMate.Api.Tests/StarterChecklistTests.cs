using CheckMate.Api.Data;
using CheckMate.Api.Models;
using Microsoft.EntityFrameworkCore;

namespace CheckMate.Api.Tests;

public class StarterChecklistTests
{
    [Fact]
    public void File_PassesTheImportChecks()
    {
        var file = ChecklistFile.Read(StarterChecklist.ReadFile());
        var errors = new List<string>();

        var steps = ChecklistImportRules.BuildSteps(file.Steps, errors);

        Assert.Empty(errors);
        Assert.NotNull(steps);
    }

    [Fact]
    public async Task AddTo_SavesTheChecklistWithItsStepsAndPrerequisites_ForTheCurrentUser()
    {
        await using var dbContext = TestDb.Create();

        var checklist = StarterChecklist.AddTo(dbContext);
        await dbContext.SaveChangesAsync();

        var saved = await dbContext.Checklists.AsNoTracking().SingleAsync();
        Assert.Equal(checklist.Id, saved.Id);
        Assert.Equal("Gemini CCR Build", saved.Name);
        Assert.Equal(TestDb.UserId, saved.UserId);
        var steps = await dbContext.ChecklistSteps
            .Where(step => step.ChecklistId == saved.Id)
            .Include(step => step.DependsOn)
            .OrderBy(step => step.SortOrder)
            .ToListAsync();
        Assert.Equal(26, steps.Count);
        Assert.Equal(StepType.Number, steps[0].Type);
        // "Flush with oxygen" waits for the oxygen cylinder and both pressure tests.
        Assert.Equal(3, steps.Single(step => step.Text == "Flush with oxygen").DependsOn.Count);
    }
}
