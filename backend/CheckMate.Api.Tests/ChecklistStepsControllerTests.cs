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

    [Fact]
    public async Task GetAll_ReturnsEachStepsPrerequisites()
    {
        await using var dbContext = CreateDbContext();
        var checklist = await AddChecklistAsync(dbContext, "Daily");
        var first = await AddStepAsync(dbContext, checklist.Id, "First", 0);
        var second = await AddStepAsync(dbContext, checklist.Id, "Second", 1);
        var third = await AddStepAsync(dbContext, checklist.Id, "Third", 2);
        await AddDependenciesAsync(dbContext, (third.Id, second.Id), (third.Id, first.Id), (second.Id, first.Id));

        var result = await CreateController(dbContext).GetAll(checklist.Id);

        var steps = Assert.IsAssignableFrom<IEnumerable<ChecklistStepResponse>>(Assert.IsType<OkObjectResult>(result.Result).Value);
        Assert.Collection(steps,
            step => Assert.Empty(step.DependsOnStepIds),
            step => Assert.Equal([first.Id], step.DependsOnStepIds),
            step => Assert.Equal([first.Id, second.Id], step.DependsOnStepIds));
    }

    [Fact]
    public async Task GetById_ReturnsPrerequisites()
    {
        await using var dbContext = CreateDbContext();
        var checklist = await AddChecklistAsync(dbContext, "Daily");
        var first = await AddStepAsync(dbContext, checklist.Id, "First", 0);
        var second = await AddStepAsync(dbContext, checklist.Id, "Second", 1);
        await AddDependenciesAsync(dbContext, (second.Id, first.Id));

        var result = await CreateController(dbContext).GetById(checklist.Id, second.Id);

        Assert.Equal([first.Id], Assert.IsType<ChecklistStepResponse>(Assert.IsType<OkObjectResult>(result.Result).Value).DependsOnStepIds);
    }

    [Fact]
    public async Task Create_SavesPrerequisites()
    {
        await using var dbContext = CreateDbContext();
        var checklist = await AddChecklistAsync(dbContext, "Daily");
        var first = await AddStepAsync(dbContext, checklist.Id, "First", 0);
        var second = await AddStepAsync(dbContext, checklist.Id, "Second", 1);
        var controller = CreateController(dbContext);

        var result = await controller.Create(
            checklist.Id,
            new ChecklistStepRequest { Text = "Third", DependsOnStepIds = [second.Id, first.Id, second.Id] });

        var created = Assert.IsType<ChecklistStepResponse>(Assert.IsType<CreatedAtActionResult>(result.Result).Value);
        Assert.Equal([first.Id, second.Id], created.DependsOnStepIds);
        Assert.Equal(
            [first.Id, second.Id],
            await dbContext.StepDependencies.Where(item => item.StepId == created.Id).Select(item => item.DependsOnStepId).Order().ToListAsync());
    }

    [Fact]
    public async Task Create_ReturnsValidationProblem_WhenPrerequisiteIsNotInTheChecklist()
    {
        await using var dbContext = CreateDbContext();
        var checklist = await AddChecklistAsync(dbContext, "Daily");
        var other = await AddChecklistAsync(dbContext, "Other");
        var elsewhere = await AddStepAsync(dbContext, other.Id, "Elsewhere");
        var controller = CreateController(dbContext);

        var result = await controller.Create(checklist.Id, new ChecklistStepRequest { Text = "Step", DependsOnStepIds = [elsewhere.Id] });

        AssertValidationError(result.Result, "A step can only depend on other steps of the same checklist.");
        Assert.False(await dbContext.ChecklistSteps.AnyAsync(step => step.ChecklistId == checklist.Id));
    }

    [Fact]
    public async Task Update_ReplacesPrerequisites()
    {
        await using var dbContext = CreateDbContext();
        var checklist = await AddChecklistAsync(dbContext, "Daily");
        var first = await AddStepAsync(dbContext, checklist.Id, "First", 0);
        var second = await AddStepAsync(dbContext, checklist.Id, "Second", 1);
        var third = await AddStepAsync(dbContext, checklist.Id, "Third", 2);
        await AddDependenciesAsync(dbContext, (third.Id, first.Id));

        var result = await CreateController(dbContext).Update(
            checklist.Id,
            third.Id,
            new ChecklistStepRequest { Text = "Third", DependsOnStepIds = [second.Id] });

        Assert.Equal([second.Id], Assert.IsType<ChecklistStepResponse>(Assert.IsType<OkObjectResult>(result.Result).Value).DependsOnStepIds);
        Assert.Equal([(third.Id, second.Id)], await dbContext.StepDependencies.Select(item => ValueTuple.Create(item.StepId, item.DependsOnStepId)).ToListAsync());
    }

    [Fact]
    public async Task Update_ClearsPrerequisites_WhenGivenAnEmptyList()
    {
        await using var dbContext = CreateDbContext();
        var checklist = await AddChecklistAsync(dbContext, "Daily");
        var first = await AddStepAsync(dbContext, checklist.Id, "First", 0);
        var second = await AddStepAsync(dbContext, checklist.Id, "Second", 1);
        await AddDependenciesAsync(dbContext, (second.Id, first.Id));

        var result = await CreateController(dbContext).Update(checklist.Id, second.Id, new ChecklistStepRequest { Text = "Second", DependsOnStepIds = [] });

        Assert.Empty(Assert.IsType<ChecklistStepResponse>(Assert.IsType<OkObjectResult>(result.Result).Value).DependsOnStepIds);
        Assert.False(await dbContext.StepDependencies.AnyAsync());
    }

    [Fact]
    public async Task Update_KeepsPrerequisites_WhenTheyAreNotGiven()
    {
        await using var dbContext = CreateDbContext();
        var checklist = await AddChecklistAsync(dbContext, "Daily");
        var first = await AddStepAsync(dbContext, checklist.Id, "First", 0);
        var second = await AddStepAsync(dbContext, checklist.Id, "Second", 1);
        await AddDependenciesAsync(dbContext, (second.Id, first.Id));

        var result = await CreateController(dbContext).Update(checklist.Id, second.Id, new ChecklistStepRequest { Text = "Renamed" });

        Assert.Equal([first.Id], Assert.IsType<ChecklistStepResponse>(Assert.IsType<OkObjectResult>(result.Result).Value).DependsOnStepIds);
        Assert.True(await dbContext.StepDependencies.AnyAsync());
    }

    [Fact]
    public async Task Update_ReturnsValidationProblem_WhenStepDependsOnItself()
    {
        await using var dbContext = CreateDbContext();
        var checklist = await AddChecklistAsync(dbContext, "Daily");
        var step = await AddStepAsync(dbContext, checklist.Id, "Step");

        var result = await CreateController(dbContext).Update(checklist.Id, step.Id, new ChecklistStepRequest { Text = "Step", DependsOnStepIds = [step.Id] });

        AssertValidationError(result.Result, "A step can't depend on itself.");
        Assert.False(await dbContext.StepDependencies.AnyAsync());
    }

    [Theory]
    [InlineData("other checklist")]
    [InlineData("unknown")]
    public async Task Update_ReturnsValidationProblem_AndKeepsTheStep_WhenPrerequisiteIsNotInTheChecklist(string prerequisite)
    {
        await using var dbContext = CreateDbContext();
        var checklist = await AddChecklistAsync(dbContext, "Daily");
        var other = await AddChecklistAsync(dbContext, "Other");
        var step = await AddStepAsync(dbContext, checklist.Id, "Step");
        var elsewhere = await AddStepAsync(dbContext, other.Id, "Elsewhere");
        var dependsOnStepId = prerequisite == "unknown" ? 999 : elsewhere.Id;

        var result = await CreateController(dbContext).Update(
            checklist.Id,
            step.Id,
            new ChecklistStepRequest { Text = "Renamed", DependsOnStepIds = [dependsOnStepId] });

        AssertValidationError(result.Result, "A step can only depend on other steps of the same checklist.");
        Assert.False(await dbContext.StepDependencies.AnyAsync());
        Assert.Equal("Step", (await dbContext.ChecklistSteps.AsNoTracking().SingleAsync(item => item.Id == step.Id)).Text);
    }

    [Fact]
    public async Task Update_ReturnsValidationProblem_WhenTwoStepsWouldDependOnEachOther()
    {
        await using var dbContext = CreateDbContext();
        var checklist = await AddChecklistAsync(dbContext, "Daily");
        var first = await AddStepAsync(dbContext, checklist.Id, "First", 0);
        var second = await AddStepAsync(dbContext, checklist.Id, "Second", 1);
        await AddDependenciesAsync(dbContext, (second.Id, first.Id));

        var result = await CreateController(dbContext).Update(checklist.Id, first.Id, new ChecklistStepRequest { Text = "First", DependsOnStepIds = [second.Id] });

        AssertValidationError(result.Result, "Steps can't depend on each other in a loop: \"First\" depends on \"Second\" depends on \"First\".");
        Assert.Equal(1, await dbContext.StepDependencies.CountAsync());
    }

    [Fact]
    public async Task Update_ReturnsValidationProblem_WhenPrerequisitesWouldMakeAnIndirectCycle()
    {
        await using var dbContext = CreateDbContext();
        var checklist = await AddChecklistAsync(dbContext, "Daily");
        var a = await AddStepAsync(dbContext, checklist.Id, "A", 0);
        var b = await AddStepAsync(dbContext, checklist.Id, "B", 1);
        var c = await AddStepAsync(dbContext, checklist.Id, "C", 2);
        var d = await AddStepAsync(dbContext, checklist.Id, "D", 3);
        // A → B → C, so C → A would close the cycle A → B → C → A. D is a fine prerequisite on its own.
        await AddDependenciesAsync(dbContext, (a.Id, b.Id), (b.Id, c.Id));

        var result = await CreateController(dbContext).Update(checklist.Id, c.Id, new ChecklistStepRequest { Text = "C", DependsOnStepIds = [d.Id, a.Id] });

        AssertValidationError(result.Result, "Steps can't depend on each other in a loop: \"C\" depends on \"A\" depends on \"B\" depends on \"C\".");
        Assert.False(await dbContext.StepDependencies.AnyAsync(item => item.StepId == c.Id));
    }

    [Fact]
    public async Task Update_AllowsADiamond()
    {
        await using var dbContext = CreateDbContext();
        var checklist = await AddChecklistAsync(dbContext, "Daily");
        var a = await AddStepAsync(dbContext, checklist.Id, "A", 0);
        var b = await AddStepAsync(dbContext, checklist.Id, "B", 1);
        var c = await AddStepAsync(dbContext, checklist.Id, "C", 2);
        var d = await AddStepAsync(dbContext, checklist.Id, "D", 3);
        await AddDependenciesAsync(dbContext, (b.Id, a.Id), (c.Id, a.Id));

        var result = await CreateController(dbContext).Update(checklist.Id, d.Id, new ChecklistStepRequest { Text = "D", DependsOnStepIds = [b.Id, c.Id] });

        Assert.Equal([b.Id, c.Id], Assert.IsType<ChecklistStepResponse>(Assert.IsType<OkObjectResult>(result.Result).Value).DependsOnStepIds);
    }

    [Fact]
    public async Task Update_RepairsTwoIndependentCyclesOneStepAtATime()
    {
        await using var dbContext = CreateDbContext();
        var checklist = await AddChecklistAsync(dbContext, "Daily");
        var a = await AddStepAsync(dbContext, checklist.Id, "A", 0);
        var b = await AddStepAsync(dbContext, checklist.Id, "B", 1);
        var c = await AddStepAsync(dbContext, checklist.Id, "C", 2);
        var d = await AddStepAsync(dbContext, checklist.Id, "D", 3);
        // Cycles the API rejects, but that two edits saved at the same moment could still leave behind.
        await AddDependenciesAsync(dbContext, (a.Id, b.Id), (b.Id, a.Id), (c.Id, d.Id), (d.Id, c.Id));

        var first = await CreateController(dbContext).Update(checklist.Id, a.Id, new ChecklistStepRequest { Text = "A", DependsOnStepIds = [] });
        var second = await CreateController(dbContext).Update(checklist.Id, c.Id, new ChecklistStepRequest { Text = "C", DependsOnStepIds = [] });

        Assert.IsType<OkObjectResult>(first.Result);
        Assert.IsType<OkObjectResult>(second.Result);
        Assert.Equal(
            [(b.Id, a.Id), (d.Id, c.Id)],
            await dbContext.StepDependencies.OrderBy(item => item.StepId).Select(item => ValueTuple.Create(item.StepId, item.DependsOnStepId)).ToListAsync());
    }

    [Fact]
    public async Task Update_AllowsKeepingPrerequisites_WhenACycleIsLeftElsewhere()
    {
        await using var dbContext = CreateDbContext();
        var checklist = await AddChecklistAsync(dbContext, "Daily");
        var a = await AddStepAsync(dbContext, checklist.Id, "A", 0);
        var b = await AddStepAsync(dbContext, checklist.Id, "B", 1);
        var c = await AddStepAsync(dbContext, checklist.Id, "C", 2);
        var d = await AddStepAsync(dbContext, checklist.Id, "D", 3);
        await AddDependenciesAsync(dbContext, (b.Id, a.Id), (c.Id, d.Id), (d.Id, c.Id));

        var result = await CreateController(dbContext).Update(checklist.Id, b.Id, new ChecklistStepRequest { Text = "Renamed", DependsOnStepIds = [a.Id] });

        var saved = Assert.IsType<ChecklistStepResponse>(Assert.IsType<OkObjectResult>(result.Result).Value);
        Assert.Equal("Renamed", saved.Text);
        Assert.Equal([a.Id], saved.DependsOnStepIds);
    }

    [Fact]
    public async Task Update_ReturnsValidationProblem_WhenAnAddedPrerequisiteLeadsBackThroughACycleElsewhere()
    {
        await using var dbContext = CreateDbContext();
        var checklist = await AddChecklistAsync(dbContext, "Daily");
        var a = await AddStepAsync(dbContext, checklist.Id, "A", 0);
        var b = await AddStepAsync(dbContext, checklist.Id, "B", 1);
        var c = await AddStepAsync(dbContext, checklist.Id, "C", 2);
        // B and C already depend on each other, and C depends on A, so A → B would lead back to A.
        await AddDependenciesAsync(dbContext, (b.Id, c.Id), (c.Id, b.Id), (c.Id, a.Id));

        var result = await CreateController(dbContext).Update(checklist.Id, a.Id, new ChecklistStepRequest { Text = "A", DependsOnStepIds = [b.Id] });

        AssertValidationError(result.Result, "Steps can't depend on each other in a loop: \"A\" depends on \"B\" depends on \"C\" depends on \"A\".");
        Assert.False(await dbContext.StepDependencies.AnyAsync(item => item.StepId == a.Id));
    }

    [Fact]
    public async Task Reorder_ReturnsPrerequisites()
    {
        await using var dbContext = CreateDbContext();
        var checklist = await AddChecklistAsync(dbContext, "Daily");
        var first = await AddStepAsync(dbContext, checklist.Id, "First", 0);
        var second = await AddStepAsync(dbContext, checklist.Id, "Second", 1);
        await AddDependenciesAsync(dbContext, (second.Id, first.Id));

        var result = await CreateController(dbContext).Reorder(checklist.Id, new ChecklistStepOrderRequest { StepIds = [second.Id, first.Id] });

        var steps = Assert.IsAssignableFrom<IEnumerable<ChecklistStepResponse>>(Assert.IsType<OkObjectResult>(result.Result).Value);
        Assert.Equal([[first.Id], []], steps.Select(step => step.DependsOnStepIds));
    }

    [Fact]
    public async Task Delete_RemovesPrerequisitesInBothDirections()
    {
        var databaseName = Guid.NewGuid().ToString();
        await using var setupContext = CreateDbContext(databaseName);
        var checklist = await AddChecklistAsync(setupContext, "Daily");
        var first = await AddStepAsync(setupContext, checklist.Id, "First", 0);
        var second = await AddStepAsync(setupContext, checklist.Id, "Second", 1);
        var third = await AddStepAsync(setupContext, checklist.Id, "Third", 2);
        await AddDependenciesAsync(setupContext, (second.Id, first.Id), (third.Id, second.Id), (third.Id, first.Id));

        // A fresh context, like a real request, so nothing is tracked yet.
        await using var dbContext = CreateDbContext(databaseName);
        var result = await CreateController(dbContext).Delete(checklist.Id, second.Id);

        Assert.IsType<NoContentResult>(result);
        await using var readContext = CreateDbContext(databaseName);
        Assert.Equal([(third.Id, first.Id)], await readContext.StepDependencies.Select(item => ValueTuple.Create(item.StepId, item.DependsOnStepId)).ToListAsync());
    }

    private static void AssertValidationError(IActionResult? result, string message)
    {
        var problem = Assert.IsType<ValidationProblemDetails>(Assert.IsType<ObjectResult>(result).Value);
        Assert.Equal([message], problem.Errors[nameof(ChecklistStepRequest.DependsOnStepIds)]);
    }

    private static async Task AddDependenciesAsync(ChecklistDbContext dbContext, params (int StepId, int DependsOnStepId)[] dependencies)
    {
        dbContext.StepDependencies.AddRange(dependencies.Select(item => new StepDependency { StepId = item.StepId, DependsOnStepId = item.DependsOnStepId }));
        await dbContext.SaveChangesAsync();
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

    private static ChecklistDbContext CreateDbContext(string? databaseName = null)
    {
        var options = new DbContextOptionsBuilder<ChecklistDbContext>()
            .UseInMemoryDatabase(databaseName ?? Guid.NewGuid().ToString())
            .Options;

        return new ChecklistDbContext(options);
    }
}
