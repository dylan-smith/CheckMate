using CheckMate.Api.Contracts;
using CheckMate.Api.Controllers;
using CheckMate.Api.Data;
using CheckMate.Api.Models;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;

namespace CheckMate.Api.Tests;

public class ChecklistImportTests
{
    [Fact]
    public async Task Import_CreatesChecklistWithStepsOptionsAndPrerequisites()
    {
        await using var dbContext = TestDb.Create();
        var controller = CreateController(dbContext);

        var result = await controller.Import(new ChecklistImportRequest
        {
            Name = "  Pre-flight  ",
            Steps =
            [
                new() { Id = "walk", Text = " Walk around " },
                new() { Id = "weather", Text = "Weather", Type = StepType.Choice, Options = [" Clear ", "Rain"] },
                new() { Text = "Take off", DependsOn = ["WEATHER", "walk"] }
            ]
        });

        var created = Assert.IsType<CreatedAtActionResult>(result.Result);
        var response = Assert.IsType<ChecklistDetailResponse>(created.Value);
        Assert.Equal("Pre-flight", response.Name);

        dbContext.ChangeTracker.Clear();
        var saved = Assert.IsType<ChecklistDetailResponse>(
            Assert.IsType<OkObjectResult>((await controller.GetById(response.Id)).Result).Value);
        Assert.Equal(["Walk around", "Weather", "Take off"], saved.Steps.Select(step => step.Text));
        Assert.Equal([StepType.Checkbox, StepType.Choice, StepType.Checkbox], saved.Steps.Select(step => step.Type));
        Assert.Equal(["Clear", "Rain"], saved.Steps[1].Options.Select(option => option.Text));
        Assert.Equal([saved.Steps[0].Id, saved.Steps[1].Id], saved.Steps[2].DependsOnStepIds.Order());
        Assert.Equal(TestDb.UserId, (await dbContext.Checklists.SingleAsync()).UserId);
    }

    [Fact]
    public async Task Import_CreatesChecklistWithNoSteps()
    {
        await using var dbContext = TestDb.Create();

        var result = await CreateController(dbContext).Import(new ChecklistImportRequest { Name = "Empty" });

        Assert.IsType<CreatedAtActionResult>(result.Result);
        Assert.Empty(await dbContext.ChecklistSteps.ToListAsync());
    }

    [Fact]
    public async Task Import_NumbersTheName_WhenItIsAlreadyUsed()
    {
        await using var dbContext = TestDb.Create();
        dbContext.Checklists.AddRange(new Checklist { Name = "Daily" }, new Checklist { Name = "daily (2)" });
        await dbContext.SaveChangesAsync();

        var result = await CreateController(dbContext).Import(new ChecklistImportRequest { Name = "DAILY" });

        var response = Assert.IsType<ChecklistDetailResponse>(Assert.IsType<CreatedAtActionResult>(result.Result).Value);
        Assert.Equal("DAILY (3)", response.Name);
    }

    [Fact]
    public async Task Import_ShortensALongName_SoTheNumberFits()
    {
        var name = new string('a', 200);
        await using var dbContext = TestDb.Create();
        dbContext.Checklists.Add(new Checklist { Name = name });
        await dbContext.SaveChangesAsync();

        var result = await CreateController(dbContext).Import(new ChecklistImportRequest { Name = name });

        var response = Assert.IsType<ChecklistDetailResponse>(Assert.IsType<CreatedAtActionResult>(result.Result).Value);
        Assert.Equal(new string('a', 196) + " (2)", response.Name);
    }

    [Fact]
    public async Task Import_IgnoresAnotherUsersChecklistNames_AndIsNotVisibleToThem()
    {
        var databaseName = Guid.NewGuid().ToString();
        await using (var otherContext = TestDb.Create(databaseName, TestDb.OtherUserId))
        {
            otherContext.Checklists.Add(new Checklist { Name = "Daily" });
            await otherContext.SaveChangesAsync();
        }

        await using (var dbContext = TestDb.Create(databaseName))
        {
            var result = await CreateController(dbContext).Import(new ChecklistImportRequest { Name = "Daily" });

            var response = Assert.IsType<ChecklistDetailResponse>(Assert.IsType<CreatedAtActionResult>(result.Result).Value);
            Assert.Equal("Daily", response.Name);
        }

        await using var theirContext = TestDb.Create(databaseName, TestDb.OtherUserId);
        Assert.Single(await theirContext.Checklists.ToListAsync());
    }

    public static TheoryData<ChecklistImportStep[], string> InvalidSteps => new()
    {
        { [new() { Text = "  " }], "Step 1: Step text is required." },
        { [new() { Text = "Done", Options = ["A", "B"] }], "Step 1: Only choice steps have options." },
        { [new() { Text = "Pick", Type = StepType.Choice, Options = ["A"] }], "Step 1: A choice step needs at least 2 options." },
        { [new() { Text = "Pick", Type = StepType.Choice, Options = ["A", "a"] }], "Step 1: Each option must be different." },
        { [new() { Text = "Pick", Type = StepType.Choice, Options = ["A", new string('b', 201)] }], "Step 1: Option text can be at most 200 characters." },
        { [new() { Id = " ", Text = "One" }], "Step 1: A step's id can't be empty." },
        { [new() { Id = "one", Text = "One" }, new() { Id = "ONE", Text = "Two" }], "Step 2: Another step already has the id 'ONE'." },
        { [new() { Text = "One", DependsOn = ["fule"] }], "Step 1 depends on 'fule', which isn't the id of any step." },
        { [new() { Id = "one", Text = "One", DependsOn = ["one"] }], "Step 1: A step can't depend on itself." },
        {
            [
                new() { Id = "a", Text = "A", DependsOn = ["c"] },
                new() { Id = "b", Text = "B", DependsOn = ["a"] },
                new() { Id = "c", Text = "C", DependsOn = ["b"] }
            ],
            "Steps can't depend on each other in a loop: \"A\" depends on \"C\" depends on \"B\" depends on \"A\"."
        }
    };

    [Theory]
    [MemberData(nameof(InvalidSteps))]
    public async Task Import_ReturnsValidationProblem_AndSavesNothing_WhenStepsAreInvalid(ChecklistImportStep[] steps, string message)
    {
        await using var dbContext = TestDb.Create();

        var result = await CreateController(dbContext).Import(new ChecklistImportRequest { Name = "Daily", Steps = steps });

        var problem = Assert.IsType<ValidationProblemDetails>(Assert.IsType<ObjectResult>(result.Result).Value);
        Assert.Contains(message, problem.Errors.SelectMany(error => error.Value));
        Assert.Empty(await dbContext.Checklists.ToListAsync());
    }

    [Fact]
    public async Task Import_ReturnsValidationProblem_WhenNameIsWhitespace()
    {
        await using var dbContext = TestDb.Create();

        var result = await CreateController(dbContext).Import(new ChecklistImportRequest { Name = "   " });

        Assert.IsType<ValidationProblemDetails>(Assert.IsType<ObjectResult>(result.Result).Value);
    }

    private static ChecklistsController CreateController(ChecklistDbContext dbContext)
    {
        return new ChecklistsController(dbContext, NullLogger<ChecklistsController>.Instance);
    }
}
