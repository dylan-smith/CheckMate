using CheckMate.Api.Contracts;
using CheckMate.Api.Controllers;
using CheckMate.Api.Data;
using CheckMate.Api.Models;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;

namespace CheckMate.Api.Tests;

public class ChecklistStepsControllerTests
{
    [Fact]
    public async Task GetAll_ReturnsStepsInOrder()
    {
        await using var dbContext = CreateDbContext();
        var checklist = await AddChecklistAsync(dbContext, "Daily");
        var other = await AddChecklistAsync(dbContext, "Other");
        dbContext.ChecklistSteps.AddRange(
            new ChecklistStep { ChecklistId = checklist.Id, Text = "Second", SortOrder = 1 },
            new ChecklistStep { ChecklistId = checklist.Id, Text = "First", SortOrder = 0 },
            new ChecklistStep { ChecklistId = other.Id, Text = "Elsewhere", SortOrder = 0 });
        await dbContext.SaveChangesAsync();

        var controller = CreateController(dbContext);

        var result = await controller.GetAll(checklist.Id);

        var okResult = Assert.IsType<OkObjectResult>(result.Result);
        var steps = Assert.IsAssignableFrom<IEnumerable<ChecklistStepResponse>>(okResult.Value);
        Assert.Collection(steps,
            step => Assert.Equal("First", step.Text),
            step => Assert.Equal("Second", step.Text));
    }

    [Fact]
    public async Task GetAll_ReturnsNotFound_WhenChecklistDoesNotExist()
    {
        await using var dbContext = CreateDbContext();
        var controller = CreateController(dbContext);

        var result = await controller.GetAll(999);

        Assert.IsType<NotFoundResult>(result.Result);
    }

    [Fact]
    public async Task Create_TrimsText_AndAppendsSteps()
    {
        await using var dbContext = CreateDbContext();
        var checklist = await AddChecklistAsync(dbContext, "Daily");
        var controller = CreateController(dbContext);

        var first = await controller.Create(checklist.Id, new ChecklistStepRequest { Text = "  Make coffee  " });
        var second = await controller.Create(checklist.Id, new ChecklistStepRequest { Text = "Read email" });

        var firstStep = Assert.IsType<ChecklistStepResponse>(Assert.IsType<CreatedAtActionResult>(first.Result).Value);
        var secondStep = Assert.IsType<ChecklistStepResponse>(Assert.IsType<CreatedAtActionResult>(second.Result).Value);
        Assert.Equal("Make coffee", firstStep.Text);
        Assert.True(secondStep.SortOrder > firstStep.SortOrder);

        var savedSteps = await dbContext.ChecklistSteps.OrderBy(step => step.SortOrder).ToListAsync();
        Assert.Collection(savedSteps,
            step => Assert.Equal("Make coffee", step.Text),
            step => Assert.Equal("Read email", step.Text));
        Assert.All(savedSteps, step => Assert.Equal(checklist.Id, step.ChecklistId));
    }

    [Fact]
    public async Task Create_ReturnsValidationProblem_WhenTextIsWhitespace()
    {
        await using var dbContext = CreateDbContext();
        var checklist = await AddChecklistAsync(dbContext, "Daily");
        var controller = CreateController(dbContext);

        var result = await controller.Create(checklist.Id, new ChecklistStepRequest { Text = "   " });

        var objectResult = Assert.IsType<ObjectResult>(result.Result);
        Assert.IsType<ValidationProblemDetails>(objectResult.Value);
        Assert.False(await dbContext.ChecklistSteps.AnyAsync());
    }

    [Fact]
    public async Task Create_ReturnsNotFound_WhenChecklistDoesNotExist()
    {
        await using var dbContext = CreateDbContext();
        var controller = CreateController(dbContext);

        var result = await controller.Create(999, new ChecklistStepRequest { Text = "Step" });

        Assert.IsType<NotFoundResult>(result.Result);
    }

    [Fact]
    public async Task Update_TrimsText_AndUpdatesStep()
    {
        await using var dbContext = CreateDbContext();
        var checklist = await AddChecklistAsync(dbContext, "Daily");
        var step = await AddStepAsync(dbContext, checklist.Id, "Old");
        var controller = CreateController(dbContext);

        var result = await controller.Update(checklist.Id, step.Id, new ChecklistStepRequest { Text = "  New  " });

        var okResult = Assert.IsType<OkObjectResult>(result.Result);
        Assert.Equal("New", Assert.IsType<ChecklistStepResponse>(okResult.Value).Text);
        Assert.Equal("New", (await dbContext.ChecklistSteps.SingleAsync()).Text);
    }

    [Fact]
    public async Task Update_ReturnsValidationProblem_WhenTextIsWhitespace()
    {
        await using var dbContext = CreateDbContext();
        var checklist = await AddChecklistAsync(dbContext, "Daily");
        var step = await AddStepAsync(dbContext, checklist.Id, "Old");
        var controller = CreateController(dbContext);

        var result = await controller.Update(checklist.Id, step.Id, new ChecklistStepRequest { Text = " " });

        var objectResult = Assert.IsType<ObjectResult>(result.Result);
        Assert.IsType<ValidationProblemDetails>(objectResult.Value);
    }

    [Fact]
    public async Task Update_ReturnsNotFound_WhenStepBelongsToAnotherChecklist()
    {
        await using var dbContext = CreateDbContext();
        var checklist = await AddChecklistAsync(dbContext, "Daily");
        var other = await AddChecklistAsync(dbContext, "Other");
        var step = await AddStepAsync(dbContext, other.Id, "Old");
        var controller = CreateController(dbContext);

        var result = await controller.Update(checklist.Id, step.Id, new ChecklistStepRequest { Text = "New" });

        Assert.IsType<NotFoundResult>(result.Result);
        Assert.Equal("Old", (await dbContext.ChecklistSteps.SingleAsync()).Text);
    }

    [Fact]
    public async Task Delete_ReturnsNoContent_AndRemovesStep()
    {
        await using var dbContext = CreateDbContext();
        var checklist = await AddChecklistAsync(dbContext, "Daily");
        var step = await AddStepAsync(dbContext, checklist.Id, "Step");
        var controller = CreateController(dbContext);

        var result = await controller.Delete(checklist.Id, step.Id);

        Assert.IsType<NoContentResult>(result);
        Assert.False(await dbContext.ChecklistSteps.AnyAsync());
    }

    [Fact]
    public async Task Delete_ReturnsNotFound_WhenStepBelongsToAnotherChecklist()
    {
        await using var dbContext = CreateDbContext();
        var checklist = await AddChecklistAsync(dbContext, "Daily");
        var other = await AddChecklistAsync(dbContext, "Other");
        var step = await AddStepAsync(dbContext, other.Id, "Step");
        var controller = CreateController(dbContext);

        var result = await controller.Delete(checklist.Id, step.Id);

        Assert.IsType<NotFoundResult>(result);
        Assert.True(await dbContext.ChecklistSteps.AnyAsync());
    }

    [Fact]
    public async Task Reorder_SavesNewOrder_AndReturnsStepsInOrder()
    {
        await using var dbContext = CreateDbContext();
        var checklist = await AddChecklistAsync(dbContext, "Daily");
        var first = await AddStepAsync(dbContext, checklist.Id, "First", 0);
        var second = await AddStepAsync(dbContext, checklist.Id, "Second", 1);
        var third = await AddStepAsync(dbContext, checklist.Id, "Third", 2);
        var controller = CreateController(dbContext);

        var result = await controller.Reorder(checklist.Id, new ChecklistStepOrderRequest { StepIds = [third.Id, first.Id, second.Id] });

        var okResult = Assert.IsType<OkObjectResult>(result.Result);
        var steps = Assert.IsAssignableFrom<IEnumerable<ChecklistStepResponse>>(okResult.Value);
        Assert.Collection(steps,
            step => Assert.Equal(("Third", 0), (step.Text, step.SortOrder)),
            step => Assert.Equal(("First", 1), (step.Text, step.SortOrder)),
            step => Assert.Equal(("Second", 2), (step.Text, step.SortOrder)));

        var getResult = await CreateController(dbContext).GetAll(checklist.Id);
        var savedSteps = Assert.IsAssignableFrom<IEnumerable<ChecklistStepResponse>>(Assert.IsType<OkObjectResult>(getResult.Result).Value);
        Assert.Equal(["Third", "First", "Second"], savedSteps.Select(step => step.Text));
    }

    [Fact]
    public async Task Reorder_AcceptsEmptyList_WhenChecklistHasNoSteps()
    {
        await using var dbContext = CreateDbContext();
        var checklist = await AddChecklistAsync(dbContext, "Daily");
        var controller = CreateController(dbContext);

        var result = await controller.Reorder(checklist.Id, new ChecklistStepOrderRequest { StepIds = [] });

        var okResult = Assert.IsType<OkObjectResult>(result.Result);
        Assert.Empty(Assert.IsAssignableFrom<IEnumerable<ChecklistStepResponse>>(okResult.Value));
    }

    public static TheoryData<string> MismatchedStepIds => ["missing", "extra", "duplicate", "unknown", "other checklist"];

    [Theory]
    [MemberData(nameof(MismatchedStepIds))]
    public async Task Reorder_ReturnsValidationProblem_AndKeepsOrder_WhenStepIdsDoNotMatch(string mismatch)
    {
        await using var dbContext = CreateDbContext();
        var checklist = await AddChecklistAsync(dbContext, "Daily");
        var other = await AddChecklistAsync(dbContext, "Other");
        var first = await AddStepAsync(dbContext, checklist.Id, "First", 0);
        var second = await AddStepAsync(dbContext, checklist.Id, "Second", 1);
        var elsewhere = await AddStepAsync(dbContext, other.Id, "Elsewhere", 0);
        var controller = CreateController(dbContext);

        IReadOnlyList<int> stepIds = mismatch switch
        {
            "missing" => [second.Id],
            "extra" => [second.Id, first.Id, 999],
            "duplicate" => [second.Id, second.Id],
            "unknown" => [second.Id, 999],
            "other checklist" => [second.Id, elsewhere.Id],
            _ => throw new ArgumentOutOfRangeException(nameof(mismatch)),
        };

        var result = await controller.Reorder(checklist.Id, new ChecklistStepOrderRequest { StepIds = stepIds });

        var objectResult = Assert.IsType<ObjectResult>(result.Result);
        Assert.IsType<ValidationProblemDetails>(objectResult.Value);
        Assert.Equal(0, (await dbContext.ChecklistSteps.SingleAsync(step => step.Id == first.Id)).SortOrder);
        Assert.Equal(1, (await dbContext.ChecklistSteps.SingleAsync(step => step.Id == second.Id)).SortOrder);
    }

    [Fact]
    public async Task Reorder_ReturnsNotFound_WhenChecklistDoesNotExist()
    {
        await using var dbContext = CreateDbContext();
        var controller = CreateController(dbContext);

        var result = await controller.Reorder(999, new ChecklistStepOrderRequest { StepIds = [] });

        Assert.IsType<NotFoundResult>(result.Result);
    }

    private static ChecklistStepsController CreateController(ChecklistDbContext dbContext)
    {
        return new(dbContext, NullLogger<ChecklistStepsController>.Instance);
    }

    private static async Task<Checklist> AddChecklistAsync(ChecklistDbContext dbContext, string name)
    {
        var checklist = new Checklist { Name = name };
        dbContext.Checklists.Add(checklist);
        await dbContext.SaveChangesAsync();
        return checklist;
    }

    private static async Task<ChecklistStep> AddStepAsync(ChecklistDbContext dbContext, int checklistId, string text, int sortOrder = 0)
    {
        var step = new ChecklistStep { ChecklistId = checklistId, Text = text, SortOrder = sortOrder };
        dbContext.ChecklistSteps.Add(step);
        await dbContext.SaveChangesAsync();
        return step;
    }

    private static ChecklistDbContext CreateDbContext()
    {
        var options = new DbContextOptionsBuilder<ChecklistDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .Options;

        return new ChecklistDbContext(options);
    }
}
