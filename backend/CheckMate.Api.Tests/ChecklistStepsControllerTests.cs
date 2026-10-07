using CheckMate.Api.Contracts;
using CheckMate.Api.Controllers;
using CheckMate.Api.Data;
using CheckMate.Api.Models;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
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
    public async Task Create_DefaultsToCheckbox_AndSavesTheGivenType()
    {
        await using var dbContext = CreateDbContext();
        var checklist = await AddChecklistAsync(dbContext, "Daily");
        var controller = CreateController(dbContext);

        var checkbox = await controller.Create(checklist.Id, new ChecklistStepRequest { Text = "Tick" });
        var text = await controller.Create(checklist.Id, new ChecklistStepRequest { Text = "Notes", Type = StepType.Text });

        Assert.Equal(StepType.Checkbox, Assert.IsType<ChecklistStepResponse>(Assert.IsType<CreatedAtActionResult>(checkbox.Result).Value).Type);
        Assert.Equal(StepType.Text, Assert.IsType<ChecklistStepResponse>(Assert.IsType<CreatedAtActionResult>(text.Result).Value).Type);
        var savedTypes = await dbContext.ChecklistSteps.OrderBy(step => step.SortOrder).Select(step => step.Type).ToListAsync();
        Assert.Equal([StepType.Checkbox, StepType.Text], savedTypes);
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
    public async Task Update_ChangesType()
    {
        await using var dbContext = CreateDbContext();
        var checklist = await AddChecklistAsync(dbContext, "Daily");
        var step = await AddStepAsync(dbContext, checklist.Id, "Notes");
        var controller = CreateController(dbContext);

        var result = await controller.Update(checklist.Id, step.Id, new ChecklistStepRequest { Text = "Notes", Type = StepType.Text });

        var okResult = Assert.IsType<OkObjectResult>(result.Result);
        Assert.Equal(StepType.Text, Assert.IsType<ChecklistStepResponse>(okResult.Value).Type);
        Assert.Equal(StepType.Text, (await dbContext.ChecklistSteps.SingleAsync()).Type);
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
    public async Task Create_SavesTrimmedOptionsInOrder_ForChoiceStep()
    {
        await using var dbContext = CreateDbContext();
        var checklist = await AddChecklistAsync(dbContext, "Daily");
        var controller = CreateController(dbContext);

        var result = await controller.Create(checklist.Id, ChoiceRequest("Weather", " Sunny ", "Rainy", "Snowy"));

        var step = Assert.IsType<ChecklistStepResponse>(Assert.IsType<CreatedAtActionResult>(result.Result).Value);
        Assert.Equal(StepType.Choice, step.Type);
        Assert.Equal(["Sunny", "Rainy", "Snowy"], step.Options.Select(option => option.Text));
        var saved = await dbContext.StepOptions.OrderBy(option => option.SortOrder).ToListAsync();
        Assert.Equal(["Sunny", "Rainy", "Snowy"], saved.Select(option => option.Text));
        Assert.All(saved, option => Assert.Equal(step.Id, option.StepId));
        Assert.Equal(saved.Select(option => option.Id), step.Options.Select(option => option.Id));
    }

    [Theory]
    [InlineData("Only one")]
    [InlineData("Sunny", " ")]
    [InlineData("Sunny", "sunny")]
    public async Task Create_ReturnsValidationProblem_WhenChoiceOptionsAreInvalid(params string[] options)
    {
        await using var dbContext = CreateDbContext();
        var checklist = await AddChecklistAsync(dbContext, "Daily");
        var controller = CreateController(dbContext);

        var result = await controller.Create(checklist.Id, ChoiceRequest("Weather", options));

        Assert.IsType<ValidationProblemDetails>(Assert.IsType<ObjectResult>(result.Result).Value);
        Assert.False(await dbContext.ChecklistSteps.AnyAsync());
    }

    [Fact]
    public async Task Create_ReturnsValidationProblem_WhenOptionsAreGivenForAnotherType()
    {
        await using var dbContext = CreateDbContext();
        var checklist = await AddChecklistAsync(dbContext, "Daily");
        var controller = CreateController(dbContext);
        var request = ChoiceRequest("Notes", "A", "B");
        request.Type = StepType.Text;

        var result = await controller.Create(checklist.Id, request);

        Assert.IsType<ValidationProblemDetails>(Assert.IsType<ObjectResult>(result.Result).Value);
        Assert.False(await dbContext.ChecklistSteps.AnyAsync());
    }

    [Fact]
    public async Task Create_ReturnsValidationProblem_WhenNewStepNamesAnExistingOption()
    {
        await using var dbContext = CreateDbContext();
        var checklist = await AddChecklistAsync(dbContext, "Daily");
        var controller = CreateController(dbContext);
        var existing = GetStep(await controller.Create(checklist.Id, ChoiceRequest("Weather", "Sunny", "Rainy")));
        var request = ChoiceRequest("Copy", "Sunny", "Rainy");
        request.Options![0].Id = existing.Options[0].Id;

        var result = await controller.Create(checklist.Id, request);

        Assert.IsType<ValidationProblemDetails>(Assert.IsType<ObjectResult>(result.Result).Value);
    }

    [Fact]
    public async Task Update_EditsKeepsAddsRemovesAndReordersOptions()
    {
        await using var dbContext = CreateDbContext();
        var checklist = await AddChecklistAsync(dbContext, "Daily");
        var controller = CreateController(dbContext);
        var created = GetStep(await controller.Create(checklist.Id, ChoiceRequest("Weather", "Sunny", "Rainy", "Snowy")));
        var (sunny, rainy) = (created.Options[0].Id, created.Options[1].Id);

        var result = await controller.Update(checklist.Id, created.Id, new ChecklistStepRequest
        {
            Text = "Weather",
            Type = StepType.Choice,
            Options = [
                new StepOptionRequest { Id = rainy, Text = "Raining" },
                new StepOptionRequest { Text = "Cloudy" },
                new StepOptionRequest { Id = sunny, Text = "Sunny" }
            ]
        });

        var step = Assert.IsType<ChecklistStepResponse>(Assert.IsType<OkObjectResult>(result.Result).Value);
        Assert.Equal(["Raining", "Cloudy", "Sunny"], step.Options.Select(option => option.Text));
        Assert.Equal(rainy, step.Options[0].Id);
        Assert.Equal(sunny, step.Options[2].Id);
        dbContext.ChangeTracker.Clear();
        var saved = await dbContext.StepOptions.OrderBy(option => option.SortOrder).ToListAsync();
        Assert.Equal(["Raining", "Cloudy", "Sunny"], saved.Select(option => option.Text));
    }

    [Fact]
    public async Task Update_ReturnsValidationProblem_WhenOptionBelongsToAnotherStep()
    {
        await using var dbContext = CreateDbContext();
        var checklist = await AddChecklistAsync(dbContext, "Daily");
        var controller = CreateController(dbContext);
        var step = GetStep(await controller.Create(checklist.Id, ChoiceRequest("Weather", "Sunny", "Rainy")));
        var other = GetStep(await controller.Create(checklist.Id, ChoiceRequest("Mood", "Happy", "Sad")));
        var request = ChoiceRequest("Weather", "Sunny", "Happy");
        request.Options![1].Id = other.Options[0].Id;

        var result = await controller.Update(checklist.Id, step.Id, request);

        Assert.IsType<ValidationProblemDetails>(Assert.IsType<ObjectResult>(result.Result).Value);
        dbContext.ChangeTracker.Clear();
        Assert.Equal(4, await dbContext.StepOptions.CountAsync());
    }

    [Fact]
    public async Task Update_ReturnsConflict_WhenARemovedOptionIsPickedWhileSaving()
    {
        var databaseName = Guid.NewGuid().ToString();
        ChecklistStepResponse step;
        int checklistId;

        await using (var setupContext = CreateDbContext(databaseName))
        {
            checklistId = (await AddChecklistAsync(setupContext, "Daily")).Id;
            step = GetStep(await CreateController(setupContext).Create(checklistId, ChoiceRequest("Weather", "Sunny", "Rainy")));
        }

        // A fill-out picks the removed option after this request cleared the runs that had, so SQL Server's
        // foreign key fails the save. The in-memory provider has no foreign keys, so the failure is thrown here instead.
        await using var dbContext = CreateDbContext(databaseName, new FailingSaveInterceptor());
        var request = ChoiceRequest("Weather", "Sunny", "Cloudy");
        request.Options![0].Id = step.Options[0].Id;

        var result = await CreateController(dbContext).Update(checklistId, step.Id, request);

        Assert.IsType<ConflictObjectResult>(result.Result);
    }

    [Fact]
    public async Task Update_Throws_WhenSaveFailsWithoutRemovingOptions()
    {
        var databaseName = Guid.NewGuid().ToString();
        ChecklistStepResponse step;
        int checklistId;

        await using (var setupContext = CreateDbContext(databaseName))
        {
            checklistId = (await AddChecklistAsync(setupContext, "Daily")).Id;
            step = GetStep(await CreateController(setupContext).Create(checklistId, ChoiceRequest("Weather", "Sunny", "Rainy")));
        }

        await using var dbContext = CreateDbContext(databaseName, new FailingSaveInterceptor());
        var request = ChoiceRequest("Weather", "Sunny", "Rainy");
        request.Options![0].Id = step.Options[0].Id;
        request.Options![1].Id = step.Options[1].Id;

        await Assert.ThrowsAsync<DbUpdateException>(() => CreateController(dbContext).Update(checklistId, step.Id, request));
    }

    [Fact]
    public async Task Update_RemovesOptions_WhenChangedToAnotherType()
    {
        await using var dbContext = CreateDbContext();
        var checklist = await AddChecklistAsync(dbContext, "Daily");
        var controller = CreateController(dbContext);
        var step = GetStep(await controller.Create(checklist.Id, ChoiceRequest("Weather", "Sunny", "Rainy")));

        var result = await controller.Update(checklist.Id, step.Id, new ChecklistStepRequest { Text = "Weather", Type = StepType.Text });

        Assert.Empty(Assert.IsType<ChecklistStepResponse>(Assert.IsType<OkObjectResult>(result.Result).Value).Options);
        Assert.False(await dbContext.StepOptions.AnyAsync());
    }

    [Fact]
    public async Task Delete_RemovesStepOptions()
    {
        await using var dbContext = CreateDbContext();
        var checklist = await AddChecklistAsync(dbContext, "Daily");
        var controller = CreateController(dbContext);
        var step = GetStep(await controller.Create(checklist.Id, ChoiceRequest("Weather", "Sunny", "Rainy")));
        dbContext.ChangeTracker.Clear();

        Assert.IsType<NoContentResult>(await controller.Delete(checklist.Id, step.Id));

        Assert.False(await dbContext.StepOptions.AnyAsync());
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
    public async Task Reorder_SavesTheWholeOrder_WhenAnotherReorderSavedFirst()
    {
        var databaseName = Guid.NewGuid().ToString();
        await using var setupContext = CreateDbContext(databaseName);
        var checklist = await AddChecklistAsync(setupContext, "Daily");
        var first = await AddStepAsync(setupContext, checklist.Id, "First", 0);
        var second = await AddStepAsync(setupContext, checklist.Id, "Second", 1);
        var third = await AddStepAsync(setupContext, checklist.Id, "Third", 2);

        await using var earlierContext = CreateDbContext(databaseName);
        await using var laterContext = CreateDbContext(databaseName);
        // Both requests read the steps before either saves.
        await laterContext.ChecklistSteps.LoadAsync();

        await CreateController(earlierContext).Reorder(checklist.Id, new ChecklistStepOrderRequest { StepIds = [second.Id, first.Id, third.Id] });
        await CreateController(laterContext).Reorder(checklist.Id, new ChecklistStepOrderRequest { StepIds = [third.Id, second.Id, first.Id] });

        await using var readContext = CreateDbContext(databaseName);
        var result = await CreateController(readContext).GetAll(checklist.Id);
        var steps = Assert.IsAssignableFrom<IEnumerable<ChecklistStepResponse>>(Assert.IsType<OkObjectResult>(result.Result).Value);
        Assert.Equal([("Third", 0), ("Second", 1), ("First", 2)], steps.Select(step => (step.Text, step.SortOrder)));
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

    private static ChecklistStepRequest ChoiceRequest(string text, params string[] options)
    {
        return new ChecklistStepRequest
        {
            Text = text,
            Type = StepType.Choice,
            Options = [.. options.Select(option => new StepOptionRequest { Text = option })]
        };
    }

    private static ChecklistStepResponse GetStep(ActionResult<ChecklistStepResponse> result)
    {
        var objectResult = Assert.IsAssignableFrom<ObjectResult>(result.Result);
        return Assert.IsType<ChecklistStepResponse>(objectResult.Value);
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

    private static ChecklistDbContext CreateDbContext(string? databaseName = null, params IInterceptor[] interceptors)
    {
        var options = new DbContextOptionsBuilder<ChecklistDbContext>()
            .UseInMemoryDatabase(databaseName ?? Guid.NewGuid().ToString())
            .AddInterceptors(interceptors)
            .Options;

        return new ChecklistDbContext(options);
    }

    // Fails every save the way a foreign key failure in SQL Server would.
    private sealed class FailingSaveInterceptor : SaveChangesInterceptor
    {
        public override ValueTask<InterceptionResult<int>> SavingChangesAsync(
            DbContextEventData eventData,
            InterceptionResult<int> result,
            CancellationToken cancellationToken = default)
        {
            throw new DbUpdateException("FK_ChecklistRunSteps_StepOptions_SelectedOptionId");
        }
    }
}
