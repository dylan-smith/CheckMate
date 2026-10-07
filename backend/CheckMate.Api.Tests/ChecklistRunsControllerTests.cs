using CheckMate.Api.Contracts;
using CheckMate.Api.Controllers;
using CheckMate.Api.Data;
using CheckMate.Api.Models;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.Logging.Abstractions;

namespace CheckMate.Api.Tests;

public class ChecklistRunsControllerTests
{
    [Fact]
    public async Task Start_CreatesRunWithEveryStepInOrder()
    {
        await using var dbContext = CreateDbContext();
        var checklist = await AddChecklistAsync(dbContext, "Daily");
        var second = await AddStepAsync(dbContext, checklist.Id, "Second", 1);
        var first = await AddStepAsync(dbContext, checklist.Id, "First", 0);
        var controller = CreateController(dbContext);
        var before = DateTimeOffset.UtcNow;

        var result = await controller.Start(checklist.Id);

        var created = Assert.IsType<CreatedAtActionResult>(result.Result);
        var run = Assert.IsType<ChecklistRunResponse>(created.Value);
        Assert.Equal(nameof(ChecklistRunsController.GetById), created.ActionName);
        Assert.Equal(checklist.Id, run.ChecklistId);
        Assert.Equal("Daily", run.ChecklistName);
        Assert.InRange(run.StartedAt, before, DateTimeOffset.UtcNow);
        Assert.Null(run.CompletedAt);
        Assert.Collection(run.Steps,
            step => Assert.Equal((first.Id, "First", false), (step.StepId!.Value, step.Text, step.IsDone)),
            step => Assert.Equal((second.Id, "Second", false), (step.StepId!.Value, step.Text, step.IsDone)));
        Assert.Equal(2, await dbContext.ChecklistRunSteps.CountAsync(step => step.RunId == run.Id));
    }

    [Fact]
    public async Task Start_ReturnsNotFound_WhenChecklistDoesNotExist()
    {
        await using var dbContext = CreateDbContext();
        var controller = CreateController(dbContext);

        var result = await controller.Start(999);

        Assert.IsType<NotFoundResult>(result.Result);
        Assert.False(await dbContext.ChecklistRuns.AnyAsync());
    }

    [Fact]
    public async Task GetById_ReturnsRunWithSavedSteps()
    {
        var databaseName = Guid.NewGuid().ToString();
        int runId;
        int stepId;

        await using (var setupContext = CreateDbContext(databaseName))
        {
            var checklist = await AddChecklistAsync(setupContext, "Daily");
            stepId = (await AddStepAsync(setupContext, checklist.Id, "Make coffee")).Id;
            var controller = CreateController(setupContext);
            runId = GetRun(await controller.Start(checklist.Id)).Id;
            await controller.UpdateStep(runId, stepId, new RunStepRequest { IsDone = true });
        }

        await using var dbContext = CreateDbContext(databaseName);

        var result = await CreateController(dbContext).GetById(runId);

        var run = Assert.IsType<ChecklistRunResponse>(Assert.IsType<OkObjectResult>(result.Result).Value);
        var step = Assert.Single(run.Steps);
        Assert.Equal(stepId, step.StepId);
        Assert.True(step.IsDone);
        Assert.NotNull(step.CompletedAt);
    }

    [Fact]
    public async Task GetById_ReturnsNotFound_WhenRunDoesNotExist()
    {
        await using var dbContext = CreateDbContext();

        var result = await CreateController(dbContext).GetById(999);

        Assert.IsType<NotFoundResult>(result.Result);
    }

    [Fact]
    public async Task GetForChecklist_ReturnsOnlyThatChecklistsRuns_NewestFirst()
    {
        await using var dbContext = CreateDbContext();
        var checklist = await AddChecklistAsync(dbContext, "Daily");
        var other = await AddChecklistAsync(dbContext, "Weekly");
        var startedAt = new DateTimeOffset(2026, 1, 1, 9, 0, 0, TimeSpan.Zero);
        dbContext.ChecklistRuns.AddRange(
            new ChecklistRun { ChecklistId = checklist.Id, StartedAt = startedAt, CompletedAt = startedAt.AddMinutes(5) },
            new ChecklistRun { ChecklistId = checklist.Id, StartedAt = startedAt.AddDays(1) },
            new ChecklistRun { ChecklistId = other.Id, StartedAt = startedAt.AddDays(2) });
        await dbContext.SaveChangesAsync();

        var result = await CreateController(dbContext).GetForChecklist(checklist.Id);

        var runs = Assert.IsType<List<ChecklistRunSummaryResponse>>(Assert.IsType<OkObjectResult>(result.Result).Value);
        Assert.Collection(runs,
            run => Assert.Equal((startedAt.AddDays(1), (DateTimeOffset?)null), (run.StartedAt, run.CompletedAt)),
            run => Assert.Equal((startedAt, (DateTimeOffset?)startedAt.AddMinutes(5)), (run.StartedAt, run.CompletedAt)));
    }

    [Fact]
    public async Task GetForChecklist_ReturnsEmptyList_WhenChecklistHasNoRuns()
    {
        await using var dbContext = CreateDbContext();
        var checklist = await AddChecklistAsync(dbContext, "Daily");

        var result = await CreateController(dbContext).GetForChecklist(checklist.Id);

        Assert.Empty(Assert.IsType<List<ChecklistRunSummaryResponse>>(Assert.IsType<OkObjectResult>(result.Result).Value));
    }

    [Fact]
    public async Task GetForChecklist_ReturnsNotFound_WhenChecklistDoesNotExist()
    {
        await using var dbContext = CreateDbContext();

        var result = await CreateController(dbContext).GetForChecklist(999);

        Assert.IsType<NotFoundResult>(result.Result);
    }

    [Fact]
    public async Task UpdateStep_SavesTick_AndClearsItWhenUnticked()
    {
        await using var dbContext = CreateDbContext();
        var checklist = await AddChecklistAsync(dbContext, "Daily");
        var step = await AddStepAsync(dbContext, checklist.Id, "Step");
        var controller = CreateController(dbContext);
        var runId = GetRun(await controller.Start(checklist.Id)).Id;
        var before = DateTimeOffset.UtcNow;

        var ticked = await controller.UpdateStep(runId, step.Id, new RunStepRequest { IsDone = true });

        var tickedStep = Assert.IsType<ChecklistRunStepResponse>(Assert.IsType<OkObjectResult>(ticked.Result).Value);
        Assert.True(tickedStep.IsDone);
        Assert.NotNull(tickedStep.CompletedAt);
        Assert.InRange(tickedStep.CompletedAt.Value, before, DateTimeOffset.UtcNow);

        var unticked = await controller.UpdateStep(runId, step.Id, new RunStepRequest { IsDone = false });

        var untickedStep = Assert.IsType<ChecklistRunStepResponse>(Assert.IsType<OkObjectResult>(unticked.Result).Value);
        Assert.False(untickedStep.IsDone);
        Assert.Null(untickedStep.CompletedAt);
        var saved = await dbContext.ChecklistRunSteps.SingleAsync();
        Assert.False(saved.IsDone);
        Assert.Null(saved.CompletedAt);
    }

    [Fact]
    public async Task Start_CopiesEachStepsType()
    {
        await using var dbContext = CreateDbContext();
        var checklist = await AddChecklistAsync(dbContext, "Daily");
        await AddStepAsync(dbContext, checklist.Id, "Tick", 0);
        await AddStepAsync(dbContext, checklist.Id, "Notes", 1, StepType.Text);

        var run = GetRun(await CreateController(dbContext).Start(checklist.Id));

        Assert.Equal([StepType.Checkbox, StepType.Text], run.Steps.Select(step => step.Type));
        Assert.All(run.Steps, step => Assert.Null(step.ResponseText));
    }

    [Fact]
    public async Task UpdateStep_SavesTrimmedText_ForTextStep_AndMarksItDone()
    {
        await using var dbContext = CreateDbContext();
        var checklist = await AddChecklistAsync(dbContext, "Daily");
        var step = await AddStepAsync(dbContext, checklist.Id, "Notes", type: StepType.Text);
        var controller = CreateController(dbContext);
        var runId = GetRun(await controller.Start(checklist.Id)).Id;

        // IsDone is ignored for a text step: only the text decides it.
        var result = await controller.UpdateStep(runId, step.Id, new RunStepRequest { Text = "  All good  ", IsDone = false });

        var saved = Assert.IsType<ChecklistRunStepResponse>(Assert.IsType<OkObjectResult>(result.Result).Value);
        Assert.Equal("All good", saved.ResponseText);
        Assert.True(saved.IsDone);
        Assert.NotNull(saved.CompletedAt);
        var reloaded = Assert.Single(GetRun(await controller.GetById(runId)).Steps);
        Assert.Equal(("All good", true), (reloaded.ResponseText, reloaded.IsDone));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public async Task UpdateStep_ClearsTextStep_WhenTextIsEmpty(string? text)
    {
        await using var dbContext = CreateDbContext();
        var checklist = await AddChecklistAsync(dbContext, "Daily");
        var step = await AddStepAsync(dbContext, checklist.Id, "Notes", type: StepType.Text);
        var controller = CreateController(dbContext);
        var runId = GetRun(await controller.Start(checklist.Id)).Id;
        await controller.UpdateStep(runId, step.Id, new RunStepRequest { Text = "Something" });

        var result = await controller.UpdateStep(runId, step.Id, new RunStepRequest { Text = text, IsDone = true });

        var saved = Assert.IsType<ChecklistRunStepResponse>(Assert.IsType<OkObjectResult>(result.Result).Value);
        Assert.Null(saved.ResponseText);
        Assert.False(saved.IsDone);
        Assert.Null(saved.CompletedAt);
    }

    [Fact]
    public async Task UpdateStep_KeepsCompletionTime_WhenTextStepIsChanged()
    {
        await using var dbContext = CreateDbContext();
        var checklist = await AddChecklistAsync(dbContext, "Daily");
        var step = await AddStepAsync(dbContext, checklist.Id, "Notes", type: StepType.Text);
        var controller = CreateController(dbContext);
        var runId = GetRun(await controller.Start(checklist.Id)).Id;
        var first = await controller.UpdateStep(runId, step.Id, new RunStepRequest { Text = "First" });
        var firstCompletedAt = Assert.IsType<ChecklistRunStepResponse>(Assert.IsType<OkObjectResult>(first.Result).Value).CompletedAt;

        var second = await controller.UpdateStep(runId, step.Id, new RunStepRequest { Text = "Second" });

        var saved = Assert.IsType<ChecklistRunStepResponse>(Assert.IsType<OkObjectResult>(second.Result).Value);
        Assert.Equal("Second", saved.ResponseText);
        Assert.Equal(firstCompletedAt, saved.CompletedAt);
    }

    [Fact]
    public async Task GetById_KeepsStepTypeFromWhenRunStarted_AfterStepTypeIsChanged()
    {
        await using var dbContext = CreateDbContext();
        var checklist = await AddChecklistAsync(dbContext, "Daily");
        var step = await AddStepAsync(dbContext, checklist.Id, "Notes", type: StepType.Text);
        var controller = CreateController(dbContext);
        var runId = GetRun(await controller.Start(checklist.Id)).Id;

        step.Type = StepType.Checkbox;
        await dbContext.SaveChangesAsync();

        Assert.Equal(StepType.Text, Assert.Single(GetRun(await controller.GetById(runId)).Steps).Type);
    }

    [Fact]
    public async Task UpdateStep_ReturnsNotFound_WhenStepIsNotInRun()
    {
        await using var dbContext = CreateDbContext();
        var checklist = await AddChecklistAsync(dbContext, "Daily");
        var controller = CreateController(dbContext);
        var runId = GetRun(await controller.Start(checklist.Id)).Id;
        // Added after the run started, so the run doesn't include it.
        var step = await AddStepAsync(dbContext, checklist.Id, "Later");

        var result = await controller.UpdateStep(runId, step.Id, new RunStepRequest { IsDone = true });

        Assert.IsType<NotFoundResult>(result.Result);
    }

    [Fact]
    public async Task UpdateStep_ReturnsNotFound_WhenRunDoesNotExist()
    {
        await using var dbContext = CreateDbContext();

        var result = await CreateController(dbContext).UpdateStep(999, 1, new RunStepRequest { IsDone = true });

        Assert.IsType<NotFoundResult>(result.Result);
    }

    [Fact]
    public async Task UpdateStep_ReturnsConflict_AndKeepsResponse_WhenRunIsComplete()
    {
        await using var dbContext = CreateDbContext();
        var checklist = await AddChecklistAsync(dbContext, "Daily");
        var step = await AddStepAsync(dbContext, checklist.Id, "Step");
        var controller = CreateController(dbContext);
        var runId = GetRun(await controller.Start(checklist.Id)).Id;
        await controller.Complete(runId);

        var result = await controller.UpdateStep(runId, step.Id, new RunStepRequest { IsDone = true });

        Assert.IsType<ConflictObjectResult>(result.Result);
        Assert.False((await dbContext.ChecklistRunSteps.SingleAsync()).IsDone);
    }

    [Fact]
    public async Task Complete_RecordsCompletionTime()
    {
        await using var dbContext = CreateDbContext();
        var checklist = await AddChecklistAsync(dbContext, "Daily");
        await AddStepAsync(dbContext, checklist.Id, "Step");
        var controller = CreateController(dbContext);
        var runId = GetRun(await controller.Start(checklist.Id)).Id;
        var before = DateTimeOffset.UtcNow;

        var result = await controller.Complete(runId);

        var run = Assert.IsType<ChecklistRunResponse>(Assert.IsType<OkObjectResult>(result.Result).Value);
        Assert.NotNull(run.CompletedAt);
        Assert.InRange(run.CompletedAt.Value, before, DateTimeOffset.UtcNow);
        Assert.Single(run.Steps);
        Assert.Equal(run.CompletedAt, (await dbContext.ChecklistRuns.SingleAsync()).CompletedAt);
    }

    [Fact]
    public async Task Complete_ReturnsConflict_WhenRunIsAlreadyComplete()
    {
        await using var dbContext = CreateDbContext();
        var checklist = await AddChecklistAsync(dbContext, "Daily");
        var controller = CreateController(dbContext);
        var runId = GetRun(await controller.Start(checklist.Id)).Id;
        var first = GetRun(await controller.Complete(runId));

        var result = await controller.Complete(runId);

        Assert.IsType<ConflictObjectResult>(result.Result);
        Assert.Equal(first.CompletedAt, (await dbContext.ChecklistRuns.SingleAsync()).CompletedAt);
    }

    [Fact]
    public async Task Complete_ReturnsNotFound_WhenRunDoesNotExist()
    {
        await using var dbContext = CreateDbContext();

        var result = await CreateController(dbContext).Complete(999);

        Assert.IsType<NotFoundResult>(result.Result);
    }

    [Fact]
    public async Task GetById_KeepsStepTextFromWhenRunStarted_AfterStepIsEditedOrDeleted()
    {
        await using var dbContext = CreateDbContext();
        var checklist = await AddChecklistAsync(dbContext, "Daily");
        var edited = await AddStepAsync(dbContext, checklist.Id, "Original text", 0);
        var deleted = await AddStepAsync(dbContext, checklist.Id, "Deleted step", 1);
        var controller = CreateController(dbContext);
        var runId = GetRun(await controller.Start(checklist.Id)).Id;
        await controller.UpdateStep(runId, deleted.Id, new RunStepRequest { IsDone = true });
        await controller.Complete(runId);

        var stepsController = new ChecklistStepsController(dbContext, NullLogger<ChecklistStepsController>.Instance);
        await stepsController.Update(checklist.Id, edited.Id, new ChecklistStepRequest { Text = "New text" });
        Assert.IsType<NoContentResult>(await stepsController.Delete(checklist.Id, deleted.Id));
        dbContext.ChangeTracker.Clear();

        var result = await controller.GetById(runId);

        var run = Assert.IsType<ChecklistRunResponse>(Assert.IsType<OkObjectResult>(result.Result).Value);
        Assert.Collection(run.Steps,
            step => Assert.Equal((edited.Id, "Original text", false), (step.StepId!.Value, step.Text, step.IsDone)),
            step =>
            {
                Assert.Null(step.StepId);
                Assert.Equal("Deleted step", step.Text);
                Assert.True(step.IsDone);
            });
    }

    [Fact]
    public async Task UpdateStep_ReturnsConflict_WhenRunIsCompletedWhileSaving()
    {
        var databaseName = Guid.NewGuid().ToString();
        var (runId, stepId) = await StartRunWithOneStepAsync(databaseName);
        await using var otherContext = CreateDbContext(databaseName);
        // Another request completes the run after this one has checked it is open, but before it saves.
        await using var dbContext = CreateDbContext(databaseName, new BeforeSaveInterceptor(async () =>
            Assert.IsType<OkObjectResult>((await CreateController(otherContext).Complete(runId)).Result)));

        var result = await CreateController(dbContext).UpdateStep(runId, stepId, new RunStepRequest { IsDone = true });

        Assert.IsType<ConflictObjectResult>(result.Result);
        await using var checkContext = CreateDbContext(databaseName);
        Assert.False((await checkContext.ChecklistRunSteps.SingleAsync()).IsDone);
        Assert.NotNull((await checkContext.ChecklistRuns.SingleAsync()).CompletedAt);
    }

    [Fact]
    public async Task Complete_ReturnsConflict_AndKeepsFirstCompletion_WhenAnotherCompletionSavesFirst()
    {
        var databaseName = Guid.NewGuid().ToString();
        var (runId, _) = await StartRunWithOneStepAsync(databaseName);
        await using var otherContext = CreateDbContext(databaseName);
        DateTimeOffset? firstCompletedAt = null;
        await using var dbContext = CreateDbContext(databaseName, new BeforeSaveInterceptor(async () =>
            firstCompletedAt = GetRun(await CreateController(otherContext).Complete(runId)).CompletedAt));

        var result = await CreateController(dbContext).Complete(runId);

        Assert.IsType<ConflictObjectResult>(result.Result);
        Assert.NotNull(firstCompletedAt);
        await using var checkContext = CreateDbContext(databaseName);
        Assert.Equal(firstCompletedAt, (await checkContext.ChecklistRuns.SingleAsync()).CompletedAt);
    }

    private static async Task<(int RunId, int StepId)> StartRunWithOneStepAsync(string databaseName)
    {
        await using var dbContext = CreateDbContext(databaseName);
        var checklist = await AddChecklistAsync(dbContext, "Daily");
        var step = await AddStepAsync(dbContext, checklist.Id, "Step");
        var run = GetRun(await CreateController(dbContext).Start(checklist.Id));
        return (run.Id, step.Id);
    }

    private static ChecklistRunResponse GetRun(ActionResult<ChecklistRunResponse> result)
    {
        var objectResult = Assert.IsAssignableFrom<ObjectResult>(result.Result);
        return Assert.IsType<ChecklistRunResponse>(objectResult.Value);
    }

    private static ChecklistRunsController CreateController(ChecklistDbContext dbContext)
    {
        return new(dbContext, NullLogger<ChecklistRunsController>.Instance);
    }

    private static async Task<Checklist> AddChecklistAsync(ChecklistDbContext dbContext, string name)
    {
        var checklist = new Checklist { Name = name };
        dbContext.Checklists.Add(checklist);
        await dbContext.SaveChangesAsync();
        return checklist;
    }

    private static async Task<ChecklistStep> AddStepAsync(ChecklistDbContext dbContext, int checklistId, string text, int sortOrder = 0, StepType type = StepType.Checkbox)
    {
        var step = new ChecklistStep { ChecklistId = checklistId, Text = text, Type = type, SortOrder = sortOrder };
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

    // Runs another request once, just before this context saves, to make two requests overlap.
    private sealed class BeforeSaveInterceptor(Func<Task> beforeSave) : SaveChangesInterceptor
    {
        private bool _ran;

        public override async ValueTask<InterceptionResult<int>> SavingChangesAsync(
            DbContextEventData eventData,
            InterceptionResult<int> result,
            CancellationToken cancellationToken = default)
        {
            if (!_ran)
            {
                _ran = true;
                await beforeSave();
            }

            return result;
        }
    }
}
