using CheckMate.Api.Contracts;
using CheckMate.Api.Controllers;
using CheckMate.Api.Data;
using CheckMate.Api.Models;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;

namespace CheckMate.Api.Tests;

public class ChecklistsControllerTests
{
    [Fact]
    public async Task Create_ReturnsConflict_WhenNameAlreadyExists()
    {
        await using var dbContext = CreateDbContext();
        dbContext.Checklists.Add(new Checklist { Name = "Daily" });
        await dbContext.SaveChangesAsync();

        var controller = new ChecklistsController(dbContext, NullLogger<ChecklistsController>.Instance);

        var result = await controller.Create(new ChecklistRequest { Name = "daily" });

        Assert.IsType<ConflictObjectResult>(result.Result);
    }

    [Fact]
    public async Task Create_TrimsName_AndPersistsChecklist()
    {
        await using var dbContext = CreateDbContext();
        var controller = new ChecklistsController(dbContext, NullLogger<ChecklistsController>.Instance);

        var result = await controller.Create(new ChecklistRequest { Name = "  Weekly  " });

        var createdResult = Assert.IsType<CreatedAtActionResult>(result.Result);
        var checklist = Assert.IsType<Checklist>(createdResult.Value);
        Assert.Equal("Weekly", checklist.Name);

        var savedChecklist = await dbContext.Checklists.SingleAsync();
        Assert.Equal("Weekly", savedChecklist.Name);
    }

    [Fact]
    public async Task Update_ReturnsConflict_WhenAnotherChecklistUsesName()
    {
        await using var dbContext = CreateDbContext();
        dbContext.Checklists.AddRange(
            new Checklist { Name = "Morning" },
            new Checklist { Name = "Evening" });
        await dbContext.SaveChangesAsync();

        var morning = await dbContext.Checklists.SingleAsync(item => item.Name == "Morning");
        var controller = new ChecklistsController(dbContext, NullLogger<ChecklistsController>.Instance);

        var result = await controller.Update(morning.Id, new ChecklistRequest { Name = "evening" });

        Assert.IsType<ConflictObjectResult>(result.Result);
    }

    [Fact]
    public async Task Update_ReturnsOk_AndUpdatesChecklist()
    {
        await using var dbContext = CreateDbContext();
        var checklist = new Checklist { Name = "Morning" };
        dbContext.Checklists.Add(checklist);
        await dbContext.SaveChangesAsync();

        var controller = new ChecklistsController(dbContext, NullLogger<ChecklistsController>.Instance);

        var result = await controller.Update(checklist.Id, new ChecklistRequest { Name = "  Workday  " });

        var okResult = Assert.IsType<OkObjectResult>(result.Result);
        var updatedChecklist = Assert.IsType<Checklist>(okResult.Value);
        Assert.Equal("Workday", updatedChecklist.Name);

        var savedChecklist = await dbContext.Checklists.SingleAsync(item => item.Id == checklist.Id);
        Assert.Equal("Workday", savedChecklist.Name);
    }

    [Fact]
    public async Task GetAll_ReturnsChecklistsOrderedByName()
    {
        await using var dbContext = CreateDbContext();
        dbContext.Checklists.AddRange(
            new Checklist { Name = "Zulu" },
            new Checklist { Name = "Alpha" });
        await dbContext.SaveChangesAsync();

        var controller = new ChecklistsController(dbContext, NullLogger<ChecklistsController>.Instance);

        var result = await controller.GetAll();

        var okResult = Assert.IsType<OkObjectResult>(result.Result);
        var checklists = Assert.IsAssignableFrom<IEnumerable<Checklist>>(okResult.Value).ToList();

        Assert.Equal(2, checklists.Count);
        Assert.Collection(checklists,
            checklist => Assert.Equal("Alpha", checklist.Name),
            checklist => Assert.Equal("Zulu", checklist.Name));
    }

    [Fact]
    public async Task GetById_ReturnsChecklistWithStepsInOrder_WhenChecklistExists()
    {
        await using var dbContext = CreateDbContext();
        var checklist = new Checklist { Name = "Daily" };
        var other = new Checklist { Name = "Other" };
        dbContext.Checklists.AddRange(checklist, other);
        await dbContext.SaveChangesAsync();

        dbContext.ChecklistSteps.AddRange(
            new ChecklistStep
            {
                ChecklistId = checklist.Id,
                Text = "Second",
                Type = StepType.Choice,
                SortOrder = 1,
                Options = [new StepOption { Text = "B", SortOrder = 1 }, new StepOption { Text = "A", SortOrder = 0 }]
            },
            new ChecklistStep { ChecklistId = checklist.Id, Text = "First", SortOrder = 0 },
            new ChecklistStep { ChecklistId = other.Id, Text = "Elsewhere", SortOrder = 0 });
        await dbContext.SaveChangesAsync();

        var controller = new ChecklistsController(dbContext, NullLogger<ChecklistsController>.Instance);

        var result = await controller.GetById(checklist.Id);

        var okResult = Assert.IsType<OkObjectResult>(result.Result);
        var returnedChecklist = Assert.IsType<ChecklistDetailResponse>(okResult.Value);
        Assert.Equal(checklist.Id, returnedChecklist.Id);
        Assert.Equal("Daily", returnedChecklist.Name);
        Assert.Collection(returnedChecklist.Steps,
            step => Assert.Equal(("First", StepType.Checkbox), (step.Text, step.Type)),
            step =>
            {
                Assert.Equal(("Second", StepType.Choice), (step.Text, step.Type));
                Assert.Equal(["A", "B"], step.Options.Select(option => option.Text));
            });
    }

    [Fact]
    public async Task GetById_ReturnsEachStepsPrerequisites()
    {
        await using var dbContext = CreateDbContext();
        var checklist = new Checklist { Name = "Daily" };
        dbContext.Checklists.Add(checklist);
        await dbContext.SaveChangesAsync();

        var first = new ChecklistStep { ChecklistId = checklist.Id, Text = "First", SortOrder = 0 };
        var second = new ChecklistStep { ChecklistId = checklist.Id, Text = "Second", SortOrder = 1 };
        dbContext.ChecklistSteps.AddRange(first, second);
        await dbContext.SaveChangesAsync();
        dbContext.StepDependencies.Add(new StepDependency { StepId = second.Id, DependsOnStepId = first.Id });
        await dbContext.SaveChangesAsync();
        dbContext.ChangeTracker.Clear();

        var controller = new ChecklistsController(dbContext, NullLogger<ChecklistsController>.Instance);

        var result = await controller.GetById(checklist.Id);

        var returnedChecklist = Assert.IsType<ChecklistDetailResponse>(Assert.IsType<OkObjectResult>(result.Result).Value);
        Assert.Equal([[], [first.Id]], returnedChecklist.Steps.Select(step => step.DependsOnStepIds));
    }

    [Fact]
    public async Task GetById_ReturnsNotFound_WhenChecklistDoesNotExist()
    {
        await using var dbContext = CreateDbContext();
        var controller = new ChecklistsController(dbContext, NullLogger<ChecklistsController>.Instance);

        var result = await controller.GetById(999);

        Assert.IsType<NotFoundResult>(result.Result);
    }

    [Fact]
    public async Task Delete_ReturnsNoContent_AndRemovesChecklist()
    {
        await using var dbContext = CreateDbContext();
        var checklist = new Checklist { Name = "Daily" };
        dbContext.Checklists.Add(checklist);
        await dbContext.SaveChangesAsync();

        var controller = new ChecklistsController(dbContext, NullLogger<ChecklistsController>.Instance);

        var result = await controller.Delete(checklist.Id);

        Assert.IsType<NoContentResult>(result);
        Assert.False(await dbContext.Checklists.AnyAsync(item => item.Id == checklist.Id));
    }

    [Fact]
    public async Task Delete_RemovesChecklistSteps()
    {
        await using var dbContext = CreateDbContext();
        var checklist = new Checklist { Name = "Daily" };
        var other = new Checklist { Name = "Other" };
        dbContext.Checklists.AddRange(checklist, other);
        await dbContext.SaveChangesAsync();

        dbContext.ChecklistSteps.AddRange(
            new ChecklistStep { ChecklistId = checklist.Id, Text = "Step", SortOrder = 0 },
            new ChecklistStep { ChecklistId = other.Id, Text = "Kept", SortOrder = 0 });
        await dbContext.SaveChangesAsync();
        dbContext.ChangeTracker.Clear();

        var controller = new ChecklistsController(dbContext, NullLogger<ChecklistsController>.Instance);

        var result = await controller.Delete(checklist.Id);

        Assert.IsType<NoContentResult>(result);
        var remainingStep = await dbContext.ChecklistSteps.SingleAsync();
        Assert.Equal("Kept", remainingStep.Text);
    }

    [Fact]
    public async Task Delete_RemovesStepPrerequisites()
    {
        await using var dbContext = CreateDbContext();
        var checklist = new Checklist { Name = "Daily" };
        var other = new Checklist { Name = "Other" };
        dbContext.Checklists.AddRange(checklist, other);
        await dbContext.SaveChangesAsync();

        var first = new ChecklistStep { ChecklistId = checklist.Id, Text = "First", SortOrder = 0 };
        var second = new ChecklistStep { ChecklistId = checklist.Id, Text = "Second", SortOrder = 1 };
        var keptFirst = new ChecklistStep { ChecklistId = other.Id, Text = "Kept first", SortOrder = 0 };
        var keptSecond = new ChecklistStep { ChecklistId = other.Id, Text = "Kept second", SortOrder = 1 };
        dbContext.ChecklistSteps.AddRange(first, second, keptFirst, keptSecond);
        await dbContext.SaveChangesAsync();
        dbContext.StepDependencies.AddRange(
            new StepDependency { StepId = second.Id, DependsOnStepId = first.Id },
            new StepDependency { StepId = keptSecond.Id, DependsOnStepId = keptFirst.Id });
        await dbContext.SaveChangesAsync();
        dbContext.ChangeTracker.Clear();

        var controller = new ChecklistsController(dbContext, NullLogger<ChecklistsController>.Instance);

        var result = await controller.Delete(checklist.Id);

        Assert.IsType<NoContentResult>(result);
        var remaining = await dbContext.StepDependencies.SingleAsync();
        Assert.Equal((keptSecond.Id, keptFirst.Id), (remaining.StepId, remaining.DependsOnStepId));
    }

    [Fact]
    public async Task Delete_RemovesChecklistRuns()
    {
        await using var dbContext = CreateDbContext();
        var checklist = new Checklist { Name = "Daily" };
        var other = new Checklist { Name = "Other" };
        dbContext.Checklists.AddRange(checklist, other);
        await dbContext.SaveChangesAsync();

        var step = new ChecklistStep
        {
            ChecklistId = checklist.Id,
            Text = "Step",
            Type = StepType.Choice,
            SortOrder = 0,
            Options = [new StepOption { Text = "Yes", SortOrder = 0 }, new StepOption { Text = "No", SortOrder = 1 }]
        };
        dbContext.ChecklistSteps.Add(step);
        await dbContext.SaveChangesAsync();

        dbContext.ChecklistRuns.AddRange(
            new ChecklistRun
            {
                ChecklistId = checklist.Id,
                Steps = [new ChecklistRunStep
                {
                    StepId = step.Id,
                    StepText = step.Text,
                    StepType = StepType.Choice,
                    SelectedOptionId = step.Options[0].Id,
                    SelectedOptionText = "Yes"
                }]
            },
            new ChecklistRun { ChecklistId = other.Id });
        await dbContext.SaveChangesAsync();
        dbContext.ChangeTracker.Clear();

        var controller = new ChecklistsController(dbContext, NullLogger<ChecklistsController>.Instance);

        var result = await controller.Delete(checklist.Id);

        Assert.IsType<NoContentResult>(result);
        Assert.Equal(other.Id, (await dbContext.ChecklistRuns.SingleAsync()).ChecklistId);
        Assert.False(await dbContext.ChecklistRunSteps.AnyAsync());
        Assert.False(await dbContext.StepOptions.AnyAsync());
    }

    [Fact]
    public async Task Delete_ReturnsNotFound_WhenChecklistDoesNotExist()
    {
        await using var dbContext = CreateDbContext();
        var controller = new ChecklistsController(dbContext, NullLogger<ChecklistsController>.Instance);

        var result = await controller.Delete(999);

        Assert.IsType<NotFoundResult>(result);
    }

    [Fact]
    public async Task Create_GivesTheChecklistToTheCurrentUser()
    {
        await using var dbContext = CreateDbContext();
        var controller = new ChecklistsController(dbContext, NullLogger<ChecklistsController>.Instance);

        await controller.Create(new ChecklistRequest { Name = "Weekly" });

        Assert.Equal(TestDb.UserId, (await dbContext.Checklists.SingleAsync()).UserId);
    }

    [Fact]
    public async Task Create_AllowsANameAnotherUserHas()
    {
        var databaseName = Guid.NewGuid().ToString();
        await using (var otherContext = TestDb.Create(databaseName, TestDb.OtherUserId))
        {
            otherContext.Checklists.Add(new Checklist { Name = "Daily" });
            await otherContext.SaveChangesAsync();
        }

        await using var dbContext = TestDb.Create(databaseName);
        var controller = new ChecklistsController(dbContext, NullLogger<ChecklistsController>.Instance);

        var result = await controller.Create(new ChecklistRequest { Name = "Daily" });

        Assert.IsType<CreatedAtActionResult>(result.Result);
    }

    [Fact]
    public async Task OtherUsersChecklists_AreNotListedOrFound()
    {
        var databaseName = Guid.NewGuid().ToString();
        int otherId;
        await using (var otherContext = TestDb.Create(databaseName, TestDb.OtherUserId))
        {
            var other = new Checklist { Name = "Theirs" };
            otherContext.Checklists.Add(other);
            await otherContext.SaveChangesAsync();
            otherId = other.Id;
        }

        await using var dbContext = TestDb.Create(databaseName);
        var controller = new ChecklistsController(dbContext, NullLogger<ChecklistsController>.Instance);

        var all = Assert.IsType<OkObjectResult>((await controller.GetAll()).Result);
        Assert.Empty(Assert.IsAssignableFrom<IEnumerable<Checklist>>(all.Value));
        Assert.IsType<NotFoundResult>((await controller.GetById(otherId)).Result);
        Assert.IsType<NotFoundResult>((await controller.Update(otherId, new ChecklistRequest { Name = "Mine" })).Result);
        Assert.IsType<NotFoundResult>(await controller.Delete(otherId));
    }

    private static ChecklistDbContext CreateDbContext()
    {
        return TestDb.Create();
    }
}
