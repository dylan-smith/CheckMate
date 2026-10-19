using System.Text;
using CheckMate.Api.Contracts;
using CheckMate.Api.Controllers;
using CheckMate.Api.Data;
using CheckMate.Api.Models;
using Microsoft.AspNetCore.Http;
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

        var result = await Import(dbContext, """
            checkmate: 1
            name: "  Pre-flight  "
            steps:
              - id: walk
                text: " Walk around "
              - id: weather
                text: Weather
                type: Choice
                options: [" Clear ", Rain]
              - text: Take off
                dependsOn: [WEATHER, walk]
            """);

        var created = Assert.IsType<CreatedAtActionResult>(result.Result);
        var response = Assert.IsType<ChecklistDetailResponse>(created.Value);
        Assert.Equal("Pre-flight", response.Name);

        dbContext.ChangeTracker.Clear();
        var saved = Assert.IsType<ChecklistDetailResponse>(
            Assert.IsType<OkObjectResult>((await CreateController(dbContext).GetById(response.Id)).Result).Value);
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

        var result = await Import(dbContext, "checkmate: 1\nname: Empty\n");

        Assert.IsType<CreatedAtActionResult>(result.Result);
        Assert.Empty(await dbContext.ChecklistSteps.ToListAsync());
    }

    [Fact]
    public async Task Import_NumbersTheName_WhenItIsAlreadyUsed()
    {
        await using var dbContext = TestDb.Create();
        dbContext.Checklists.AddRange(new Checklist { Name = "Daily" }, new Checklist { Name = "daily (2)" });
        await dbContext.SaveChangesAsync();

        var result = await Import(dbContext, "checkmate: 1\nname: DAILY\n");

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

        var result = await Import(dbContext, $"checkmate: 1\nname: {name}\n");

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
            var result = await Import(dbContext, "checkmate: 1\nname: Daily\n");

            var response = Assert.IsType<ChecklistDetailResponse>(Assert.IsType<CreatedAtActionResult>(result.Result).Value);
            Assert.Equal("Daily", response.Name);
        }

        await using var theirContext = TestDb.Create(databaseName, TestDb.OtherUserId);
        Assert.Single(await theirContext.Checklists.ToListAsync());
    }

    [Theory]
    [InlineData("steps:\n  - text: \"  \"", "Step 1: Step text is required.")]
    [InlineData("steps:\n  - text: Done\n    options: [A, B]", "Step 1: Only choice steps have options.")]
    [InlineData("steps:\n  - text: Pick\n    type: Choice\n    options: [A]", "Step 1: A choice step needs at least 2 options.")]
    [InlineData("steps:\n  - text: Pick\n    type: Choice\n    options: [A, a]", "Step 1: Each option must be different.")]
    [InlineData("steps:\n  - id: \" \"\n    text: One", "Step 1: A step's id can't be empty.")]
    [InlineData("steps:\n  - id: one\n    text: One\n  - id: ONE\n    text: Two", "Step 2: Another step already has the id 'ONE'.")]
    [InlineData("steps:\n  - text: One\n    dependsOn: [fule]", "Step 1 depends on 'fule', which isn't the id of any step.")]
    [InlineData("steps:\n  - id: one\n    text: One\n    dependsOn: one", "Step 1: A step can't depend on itself.")]
    [InlineData(
        "steps:\n  - { id: a, text: A, dependsOn: c }\n  - { id: b, text: B, dependsOn: a }\n  - { id: c, text: C, dependsOn: b }",
        "Steps can't depend on each other in a loop: \"A\" depends on \"C\" depends on \"B\" depends on \"A\".")]
    [InlineData("steps: nope", "The checklist file's steps must be a list.")]
    public async Task Import_ReturnsValidationProblem_AndSavesNothing_WhenTheFileIsInvalid(string steps, string message)
    {
        await using var dbContext = TestDb.Create();

        var result = await Import(dbContext, $"checkmate: 1\nname: Daily\n{steps}\n");

        Assert.Contains(message, ValidationMessages(result));
        Assert.Empty(await dbContext.Checklists.ToListAsync());
    }

    public static TheoryData<string, string> OverLimitFiles => new()
    {
        { $"name: {new string('n', 201)}", "The checklist name can be at most 200 characters." },
        { "name: A\nsteps:\n" + string.Concat(Enumerable.Repeat("  - Step\n", 501)), "A checklist file can have at most 500 steps." },
        { $"name: A\nsteps:\n  - {new string('t', 501)}", "Step 1: Step text can be at most 500 characters." },
        { $"name: A\nsteps:\n  - id: {new string('i', 101)}\n    text: A", "Step 1: A step's id can be at most 100 characters." },
        {
            $"name: A\nsteps:\n  - text: A\n    type: Choice\n    options: [{string.Join(", ", Enumerable.Range(1, 51))}]",
            "Step 1: A step can have at most 50 options."
        },
        {
            $"name: A\nsteps:\n  - text: A\n    type: Choice\n    options: [B, {new string('o', 201)}]",
            "Step 1: Option text can be at most 200 characters."
        }
    };

    [Theory]
    [MemberData(nameof(OverLimitFiles))]
    public async Task Import_ReturnsValidationProblem_WhenTheFileIsOverALimit(string file, string message)
    {
        await using var dbContext = TestDb.Create();

        var result = await Import(dbContext, $"checkmate: 1\n{file}\n");

        Assert.Contains(message, ValidationMessages(result));
        Assert.Empty(await dbContext.Checklists.ToListAsync());
    }

    [Fact]
    public async Task Import_ReturnsValidationProblem_WhenTheFileIsNotYaml()
    {
        await using var dbContext = TestDb.Create();

        var result = await Import(dbContext, "checkmate: 1\nname: a: b\nsteps: []\n");

        Assert.Contains("This file isn't valid YAML. Check line 2.", ValidationMessages(result));
    }

    [Fact]
    public async Task Export_ReturnsTheChecklistAsAYamlFile_ThatImportsAsACopy()
    {
        await using var dbContext = TestDb.Create();
        var imported = Assert.IsType<ChecklistDetailResponse>(Assert.IsType<CreatedAtActionResult>((await Import(dbContext, """
            checkmate: 1
            name: Pre-flight checks
            steps:
              - id: walk
                text: Walk around
              - text: Take off
                dependsOn: walk
            """)).Result).Value);
        dbContext.ChangeTracker.Clear();

        var file = Assert.IsType<FileContentResult>(await CreateController(dbContext).Export(imported.Id));

        Assert.Equal("application/yaml", file.ContentType);
        Assert.Equal("pre-flight-checks.yml", file.FileDownloadName);
        var yaml = Encoding.UTF8.GetString(file.FileContents);
        Assert.Contains("  - id: walk-around\n    text: Walk around\n", yaml, StringComparison.Ordinal);

        var copy = Assert.IsType<ChecklistDetailResponse>(Assert.IsType<CreatedAtActionResult>((await Import(dbContext, yaml)).Result).Value);
        Assert.Equal("Pre-flight checks (2)", copy.Name);
        Assert.Equal([copy.Steps[0].Id], copy.Steps[1].DependsOnStepIds);
    }

    [Fact]
    public async Task Export_ReturnsNotFound_ForAnotherUsersChecklist()
    {
        var databaseName = Guid.NewGuid().ToString();
        int theirId;
        await using (var otherContext = TestDb.Create(databaseName, TestDb.OtherUserId))
        {
            var theirs = new Checklist { Name = "Theirs" };
            otherContext.Checklists.Add(theirs);
            await otherContext.SaveChangesAsync();
            theirId = theirs.Id;
        }

        await using var dbContext = TestDb.Create(databaseName);

        Assert.IsType<NotFoundResult>(await CreateController(dbContext).Export(theirId));
    }

    private static Task<ActionResult<ChecklistDetailResponse>> Import(ChecklistDbContext dbContext, string yaml)
    {
        var controller = CreateController(dbContext);
        controller.ControllerContext = new ControllerContext
        {
            HttpContext = new DefaultHttpContext { Request = { Body = new MemoryStream(Encoding.UTF8.GetBytes(yaml)) } }
        };
        return controller.Import();
    }

    private static IEnumerable<string> ValidationMessages(ActionResult<ChecklistDetailResponse> result)
    {
        var problem = Assert.IsType<ValidationProblemDetails>(Assert.IsType<ObjectResult>(result.Result).Value);
        return problem.Errors.SelectMany(error => error.Value);
    }

    private static ChecklistsController CreateController(ChecklistDbContext dbContext)
    {
        return new ChecklistsController(dbContext, NullLogger<ChecklistsController>.Instance);
    }
}
