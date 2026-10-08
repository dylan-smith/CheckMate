using CheckMate.Api.Contracts;
using CheckMate.Api.Controllers;
using CheckMate.Api.Models;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace CheckMate.Api.Tests;

// Syncing a run a device filled out, which may have happened with no connection.
public partial class ChecklistRunsControllerTests
{
    private static readonly DateTimeOffset StartedAt = new(2026, 10, 1, 8, 0, 0, TimeSpan.Zero);

    [Fact]
    public async Task Start_GivesTheRunAClientKey()
    {
        await using var dbContext = CreateDbContext();
        var checklist = await AddChecklistAsync(dbContext, "Daily");
        var controller = CreateController(dbContext);

        var first = GetRun(await controller.Start(checklist.Id));
        var second = GetRun(await controller.Start(checklist.Id));

        Assert.NotEqual(Guid.Empty, first.ClientKey);
        Assert.NotEqual(first.ClientKey, second.ClientKey);
        Assert.Equal(first.ClientKey, (await dbContext.ChecklistRuns.SingleAsync(run => run.Id == first.Id)).ClientKey);
    }

    [Fact]
    public async Task GetByKey_ReturnsTheRun()
    {
        await using var dbContext = CreateDbContext();
        var checklist = await AddChecklistAsync(dbContext, "Daily");
        await AddStepAsync(dbContext, checklist.Id, "Step");
        var controller = CreateController(dbContext);
        var started = GetRun(await controller.Start(checklist.Id));

        var result = await controller.GetByKey(started.ClientKey);

        var run = Assert.IsType<ChecklistRunResponse>(Assert.IsType<OkObjectResult>(result.Result).Value);
        Assert.Equal((started.Id, started.ClientKey, "Daily"), (run.Id, run.ClientKey, run.ChecklistName));
        Assert.Equal("Step", Assert.Single(run.Steps).Text);
    }

    [Fact]
    public async Task GetByKey_ReturnsNotFound_WhenNoRunHasTheKey()
    {
        await using var dbContext = CreateDbContext();

        var result = await CreateController(dbContext).GetByKey(Guid.NewGuid());

        Assert.IsType<NotFoundResult>(result.Result);
    }

    [Fact]
    public async Task Sync_CreatesRun_WithTheStepsAndTimesTheDeviceSent()
    {
        await using var dbContext = CreateDbContext();
        var checklist = await AddChecklistAsync(dbContext, "Daily");
        var tick = await AddStepAsync(dbContext, checklist.Id, "Tick", 0);
        var notes = await AddStepAsync(dbContext, checklist.Id, "Notes", 1, StepType.Text);
        var depth = await AddStepAsync(dbContext, checklist.Id, "Depth", 2, StepType.Number);
        var weather = await AddChoiceStepAsync(dbContext, checklist.Id, "Weather", "Sunny", "Rainy");
        var rainy = weather.Options.Single(option => option.Text == "Rainy");
        var key = Guid.NewGuid();
        var request = SyncRequest(
            StartedAt,
            null,
            SyncStep(tick, isDone: true, completedAt: StartedAt.AddMinutes(1)),
            SyncStep(notes, text: "  Looked fine  ", completedAt: StartedAt.AddMinutes(2)),
            SyncStep(depth, number: 12.5m, completedAt: StartedAt.AddMinutes(3)),
            SyncStep(weather));

        var result = await CreateController(dbContext).Sync(checklist.Id, key, request);

        var created = Assert.IsType<CreatedAtActionResult>(result.Result);
        Assert.Equal(nameof(ChecklistRunsController.GetById), created.ActionName);
        var run = Assert.IsType<ChecklistRunResponse>(created.Value);
        Assert.Equal((key, checklist.Id, "Daily", StartedAt, (DateTimeOffset?)null), (run.ClientKey, run.ChecklistId, run.ChecklistName, run.StartedAt, run.CompletedAt));
        Assert.Collection(run.Steps,
            step =>
            {
                Assert.Equal((tick.Id, "Tick", StepType.Checkbox, true), (step.StepId, step.Text, step.Type, step.IsDone));
                Assert.Equal(StartedAt.AddMinutes(1), step.CompletedAt);
            },
            step =>
            {
                Assert.Equal((notes.Id, StepType.Text, true, "Looked fine"), (step.StepId, step.Type, step.IsDone, step.ResponseText));
                Assert.Equal(StartedAt.AddMinutes(2), step.CompletedAt);
            },
            step =>
            {
                Assert.Equal((depth.Id, StepType.Number, true, 12.5m), (step.StepId, step.Type, step.IsDone, step.ResponseNumber));
                Assert.Equal(StartedAt.AddMinutes(3), step.CompletedAt);
            },
            step =>
            {
                Assert.Equal((weather.Id, StepType.Choice, false, (int?)null), (step.StepId, step.Type, step.IsDone, step.SelectedOptionId));
                Assert.Null(step.CompletedAt);
                Assert.Equal(["Sunny", "Rainy"], step.Options.Select(option => option.Text));
            });
        Assert.Equal(run.Id, (await dbContext.ChecklistRuns.SingleAsync()).Id);
        Assert.Equal(4, await dbContext.ChecklistRunSteps.CountAsync(step => step.RunId == run.Id));
        Assert.Equal(rainy.Id, weather.Options.Single(option => option.Text == "Rainy").Id);
    }

    [Fact]
    public async Task Sync_CompletesRun_WhenEveryStepIsDone()
    {
        await using var dbContext = CreateDbContext();
        var checklist = await AddChecklistAsync(dbContext, "Daily");
        var step = await AddStepAsync(dbContext, checklist.Id, "Step");
        var completedAt = StartedAt.AddMinutes(10);

        var run = GetRun(await CreateController(dbContext).Sync(
            checklist.Id,
            Guid.NewGuid(),
            SyncRequest(StartedAt, completedAt, SyncStep(step, isDone: true, completedAt: StartedAt.AddMinutes(1)))));

        Assert.Equal(completedAt, run.CompletedAt);
        Assert.Equal(completedAt, (await dbContext.ChecklistRuns.SingleAsync()).CompletedAt);
    }

    [Fact]
    public async Task Sync_ReturnsTheSameRun_WhenSentTwice()
    {
        await using var dbContext = CreateDbContext();
        var checklist = await AddChecklistAsync(dbContext, "Daily");
        var step = await AddStepAsync(dbContext, checklist.Id, "Step");
        var controller = CreateController(dbContext);
        var key = Guid.NewGuid();
        var request = SyncRequest(StartedAt, null, SyncStep(step, isDone: true, completedAt: StartedAt.AddMinutes(1)));
        var first = GetRun(await controller.Sync(checklist.Id, key, request));

        var result = await controller.Sync(checklist.Id, key, request);

        var second = Assert.IsType<ChecklistRunResponse>(Assert.IsType<OkObjectResult>(result.Result).Value);
        Assert.Equal((first.Id, first.ClientKey, first.StartedAt), (second.Id, second.ClientKey, second.StartedAt));
        Assert.Equal(
            first.Steps.Select(item => (item.StepId, item.IsDone, item.CompletedAt)),
            second.Steps.Select(item => (item.StepId, item.IsDone, item.CompletedAt)));
        Assert.Equal(1, await dbContext.ChecklistRuns.CountAsync());
        Assert.Equal(1, await dbContext.ChecklistRunSteps.CountAsync());
    }

    [Fact]
    public async Task Sync_UpdatesAnswers_OfAnOpenRun()
    {
        await using var dbContext = CreateDbContext();
        var checklist = await AddChecklistAsync(dbContext, "Daily");
        var tick = await AddStepAsync(dbContext, checklist.Id, "Tick", 0);
        var notes = await AddStepAsync(dbContext, checklist.Id, "Notes", 1, StepType.Text);
        var depth = await AddStepAsync(dbContext, checklist.Id, "Depth", 2, StepType.Number);
        var controller = CreateController(dbContext);
        var key = Guid.NewGuid();
        await controller.Sync(checklist.Id, key, SyncRequest(
            StartedAt,
            null,
            SyncStep(tick, isDone: true, completedAt: StartedAt.AddMinutes(1)),
            SyncStep(notes, text: "First", completedAt: StartedAt.AddMinutes(2)),
            SyncStep(depth)));

        var run = GetRun(await controller.Sync(checklist.Id, key, SyncRequest(
            StartedAt,
            null,
            SyncStep(tick),
            SyncStep(notes, text: "Second", completedAt: StartedAt.AddMinutes(2)),
            SyncStep(depth, number: 30, completedAt: StartedAt.AddMinutes(4)))));

        Assert.Collection(run.Steps,
            step => Assert.Equal((false, (DateTimeOffset?)null), (step.IsDone, step.CompletedAt)),
            step => Assert.Equal(("Second", true), (step.ResponseText, step.IsDone)),
            step => Assert.Equal((30m, true, StartedAt.AddMinutes(4)), (step.ResponseNumber, step.IsDone, step.CompletedAt)));
        Assert.Equal(1, await dbContext.ChecklistRuns.CountAsync());
    }

    [Fact]
    public async Task Sync_KeepsStepTextAndType_FromTheFirstSync()
    {
        await using var dbContext = CreateDbContext();
        var checklist = await AddChecklistAsync(dbContext, "Daily");
        var step = await AddStepAsync(dbContext, checklist.Id, "Current text");
        var controller = CreateController(dbContext);
        var key = Guid.NewGuid();
        var first = new RunSyncStepRequest { StepId = step.Id, Text = "  As the device showed it  ", Type = StepType.Checkbox };
        await controller.Sync(checklist.Id, key, SyncRequest(StartedAt, null, first));

        var second = new RunSyncStepRequest { StepId = step.Id, Text = "Changed", Type = StepType.Text, ResponseText = "Ignored" };
        var run = GetRun(await controller.Sync(checklist.Id, key, SyncRequest(StartedAt, null, second)));

        var runStep = Assert.Single(run.Steps);
        Assert.Equal(("As the device showed it", StepType.Checkbox, false, (string?)null), (runStep.Text, runStep.Type, runStep.IsDone, runStep.ResponseText));
    }

    [Fact]
    public async Task Sync_StoresAStepTheChecklistNoLongerHas_AsDeleted()
    {
        await using var dbContext = CreateDbContext();
        var checklist = await AddChecklistAsync(dbContext, "Daily");
        var step = await AddStepAsync(dbContext, checklist.Id, "Step");
        var deleted = new RunSyncStepRequest { StepId = 999, Text = "Gone", Type = StepType.Text, ResponseText = "Still answered", CompletedAt = StartedAt.AddMinutes(1) };

        // The deleted step was done, and a deleted step that wasn't done doesn't hold the run back either.
        var run = GetRun(await CreateController(dbContext).Sync(
            checklist.Id,
            Guid.NewGuid(),
            SyncRequest(StartedAt, StartedAt.AddMinutes(5), SyncStep(step, isDone: true, completedAt: StartedAt.AddMinutes(1)), deleted)));

        Assert.NotNull(run.CompletedAt);
        Assert.Collection(run.Steps,
            runStep => Assert.Equal(step.Id, runStep.StepId),
            runStep => Assert.Equal(((int?)null, "Gone", "Still answered", true), (runStep.StepId, runStep.Text, runStep.ResponseText, runStep.IsDone)));
    }

    [Fact]
    public async Task Sync_LeavesOutStepsAddedToTheChecklistSinceTheDeviceStarted()
    {
        await using var dbContext = CreateDbContext();
        var checklist = await AddChecklistAsync(dbContext, "Daily");
        var step = await AddStepAsync(dbContext, checklist.Id, "Step", 0);
        await AddStepAsync(dbContext, checklist.Id, "Added later", 1);

        var run = GetRun(await CreateController(dbContext).Sync(
            checklist.Id,
            Guid.NewGuid(),
            SyncRequest(StartedAt, StartedAt.AddMinutes(5), SyncStep(step, isDone: true, completedAt: StartedAt.AddMinutes(1)))));

        Assert.Equal(step.Id, Assert.Single(run.Steps).StepId);
        Assert.NotNull(run.CompletedAt);
    }

    [Fact]
    public async Task Sync_SkipsAnswersForStepsDeletedSinceTheRunWasSynced()
    {
        await using var dbContext = CreateDbContext();
        var checklist = await AddChecklistAsync(dbContext, "Daily");
        var kept = await AddStepAsync(dbContext, checklist.Id, "Kept", 0);
        var deleted = await AddStepAsync(dbContext, checklist.Id, "Deleted", 1, StepType.Text);
        var controller = CreateController(dbContext);
        var key = Guid.NewGuid();
        await controller.Sync(checklist.Id, key, SyncRequest(StartedAt, null, SyncStep(kept), SyncStep(deleted, text: "Before")));
        // Deleting a checklist step unlinks its run steps, as ChecklistStepsController does.
        var runStep = await dbContext.ChecklistRunSteps.SingleAsync(step => step.StepId == deleted.Id);
        runStep.StepId = null;
        dbContext.ChecklistSteps.Remove(deleted);
        await dbContext.SaveChangesAsync();

        var result = await controller.Sync(checklist.Id, key, SyncRequest(
            StartedAt,
            null,
            SyncStep(kept, isDone: true, completedAt: StartedAt.AddMinutes(1)),
            SyncStep(deleted, text: "After")));

        var run = Assert.IsType<ChecklistRunResponse>(Assert.IsType<OkObjectResult>(result.Result).Value);
        Assert.Collection(run.Steps,
            step => Assert.True(step.IsDone),
            step => Assert.Equal(((int?)null, "Before"), (step.StepId, step.ResponseText)));
    }

    [Fact]
    public async Task Sync_KeepsPickedOptionText_WhenTheOptionWasRemovedWhileOffline()
    {
        await using var dbContext = CreateDbContext();
        var checklist = await AddChecklistAsync(dbContext, "Daily");
        var weather = await AddChoiceStepAsync(dbContext, checklist.Id, "Weather", "Sunny", "Rainy");

        var run = GetRun(await CreateController(dbContext).Sync(
            checklist.Id,
            Guid.NewGuid(),
            SyncRequest(StartedAt, null, SyncStep(weather, optionId: 999, optionText: " Foggy ", completedAt: StartedAt.AddMinutes(1)))));

        var step = Assert.Single(run.Steps);
        Assert.Equal((true, (int?)null, "Foggy"), (step.IsDone, step.SelectedOptionId, step.SelectedOptionText));
    }

    [Fact]
    public async Task Sync_PicksTheOptionByItsId_AndKeepsItsCurrentText()
    {
        await using var dbContext = CreateDbContext();
        var checklist = await AddChecklistAsync(dbContext, "Daily");
        var weather = await AddChoiceStepAsync(dbContext, checklist.Id, "Weather", "Sunny", "Rainy");
        var rainy = weather.Options.Single(option => option.Text == "Rainy");

        var run = GetRun(await CreateController(dbContext).Sync(
            checklist.Id,
            Guid.NewGuid(),
            SyncRequest(StartedAt, null, SyncStep(weather, optionId: rainy.Id, optionText: "Old text", completedAt: StartedAt.AddMinutes(1)))));

        var step = Assert.Single(run.Steps);
        Assert.Equal((true, rainy.Id, "Rainy"), (step.IsDone, step.SelectedOptionId, step.SelectedOptionText));
    }

    [Fact]
    public async Task Sync_ReturnsValidationProblem_WhenAStepIsSentTwice()
    {
        await using var dbContext = CreateDbContext();
        var checklist = await AddChecklistAsync(dbContext, "Daily");
        var step = await AddStepAsync(dbContext, checklist.Id, "Step");

        var result = await CreateController(dbContext).Sync(checklist.Id, Guid.NewGuid(), SyncRequest(StartedAt, null, SyncStep(step), SyncStep(step)));

        var problem = GetValidationProblem(result.Result);
        Assert.Equal("Each step can only be sent once.", Assert.Single(problem.Errors["Steps"]));
        Assert.False(await dbContext.ChecklistRuns.AnyAsync());
    }

    [Fact]
    public async Task Sync_ReturnsValidationProblem_AndSavesNothing_WhenANumberDoesNotFit()
    {
        await using var dbContext = CreateDbContext();
        var checklist = await AddChecklistAsync(dbContext, "Daily");
        var tick = await AddStepAsync(dbContext, checklist.Id, "Tick", 0);
        var depth = await AddStepAsync(dbContext, checklist.Id, "Depth", 1, StepType.Number);

        var result = await CreateController(dbContext).Sync(
            checklist.Id,
            Guid.NewGuid(),
            SyncRequest(StartedAt, null, SyncStep(tick, isDone: true), SyncStep(depth, number: 1.1234567m)));

        var problem = GetValidationProblem(result.Result);
        Assert.Equal(
            "The number must have at most 9 digits before the decimal point and 6 after it.",
            Assert.Single(problem.Errors["Steps[1].ResponseNumber"]));
        Assert.False(await dbContext.ChecklistRuns.AnyAsync());
    }

    [Fact]
    public async Task Sync_ReturnsValidationProblem_WhenAnOptionIsNotOnTheStep()
    {
        await using var dbContext = CreateDbContext();
        var checklist = await AddChecklistAsync(dbContext, "Daily");
        var weather = await AddChoiceStepAsync(dbContext, checklist.Id, "Weather", "Sunny", "Rainy");
        var other = await AddChoiceStepAsync(dbContext, checklist.Id, "Visibility", "Good", "Poor");

        var result = await CreateController(dbContext).Sync(
            checklist.Id,
            Guid.NewGuid(),
            SyncRequest(StartedAt, null, SyncStep(weather, optionId: other.Options[0].Id)));

        var problem = GetValidationProblem(result.Result);
        Assert.Equal("The option must be one of this step's options.", Assert.Single(problem.Errors["Steps[0].SelectedOptionId"]));
    }

    [Fact]
    public async Task Sync_ReturnsValidationProblem_WhenADoneStepsPrerequisiteIsNotDone()
    {
        await using var dbContext = CreateDbContext();
        var checklist = await AddChecklistAsync(dbContext, "Daily");
        var first = await AddStepAsync(dbContext, checklist.Id, "First", 0);
        var second = await AddStepAsync(dbContext, checklist.Id, "Second", 1);
        await AddDependencyAsync(dbContext, second, first);

        var result = await CreateController(dbContext).Sync(
            checklist.Id,
            Guid.NewGuid(),
            SyncRequest(StartedAt, null, SyncStep(first), SyncStep(second, isDone: true)));

        var problem = GetValidationProblem(result.Result);
        Assert.Equal("This step can't be filled in until the steps it depends on are done.", Assert.Single(problem.Errors["Steps[1]"]));
        Assert.False(await dbContext.ChecklistRuns.AnyAsync());
    }

    [Fact]
    public async Task Sync_ReturnsValidationProblem_AndChangesNothing_WhenUndoingAStepADoneStepDependsOn()
    {
        await using var dbContext = CreateDbContext();
        var checklist = await AddChecklistAsync(dbContext, "Daily");
        var first = await AddStepAsync(dbContext, checklist.Id, "First", 0);
        var second = await AddStepAsync(dbContext, checklist.Id, "Second", 1);
        await AddDependencyAsync(dbContext, second, first);
        var controller = CreateController(dbContext);
        var key = Guid.NewGuid();
        await controller.Sync(checklist.Id, key, SyncRequest(StartedAt, null, SyncStep(first, isDone: true), SyncStep(second, isDone: true)));

        // The request leaves the second step out, so it stays done while the first is un-done.
        var result = await controller.Sync(checklist.Id, key, SyncRequest(StartedAt, null, SyncStep(first)));

        var problem = GetValidationProblem(result.Result);
        Assert.Equal("This step can't be filled in until the steps it depends on are done.", Assert.Single(problem.Errors["Steps"]));
        dbContext.ChangeTracker.Clear();
        Assert.All(await dbContext.ChecklistRunSteps.ToListAsync(), step => Assert.True(step.IsDone));
    }

    [Fact]
    public async Task Sync_ReturnsValidationProblem_WhenCompletedButAStepIsNotDone()
    {
        await using var dbContext = CreateDbContext();
        var checklist = await AddChecklistAsync(dbContext, "Daily");
        var step = await AddStepAsync(dbContext, checklist.Id, "Step");

        var result = await CreateController(dbContext).Sync(checklist.Id, Guid.NewGuid(), SyncRequest(StartedAt, StartedAt.AddMinutes(5), SyncStep(step)));

        var problem = GetValidationProblem(result.Result);
        Assert.Equal("Every step must be done before the run can be completed.", Assert.Single(problem.Errors["CompletedAt"]));
        Assert.False(await dbContext.ChecklistRuns.AnyAsync());
    }

    [Fact]
    public async Task Sync_ReportsEveryProblemAtOnce()
    {
        await using var dbContext = CreateDbContext();
        var checklist = await AddChecklistAsync(dbContext, "Daily");
        var tick = await AddStepAsync(dbContext, checklist.Id, "Tick", 0);
        var depth = await AddStepAsync(dbContext, checklist.Id, "Depth", 1, StepType.Number);

        var result = await CreateController(dbContext).Sync(
            checklist.Id,
            Guid.NewGuid(),
            SyncRequest(StartedAt, StartedAt.AddMinutes(5), SyncStep(tick), SyncStep(depth, number: 1234567890m)));

        var problem = GetValidationProblem(result.Result);
        Assert.Equal(["CompletedAt", "Steps[1].ResponseNumber"], problem.Errors.Keys.Order());
    }

    [Fact]
    public async Task Sync_ReturnsConflict_WhenTheRunIsCompleteAndTheDeviceSendsItOpen()
    {
        await using var dbContext = CreateDbContext();
        var checklist = await AddChecklistAsync(dbContext, "Daily");
        var step = await AddStepAsync(dbContext, checklist.Id, "Step", type: StepType.Text);
        var controller = CreateController(dbContext);
        var key = Guid.NewGuid();
        await controller.Sync(checklist.Id, key, SyncRequest(StartedAt, StartedAt.AddMinutes(5), SyncStep(step, text: "Done")));

        var result = await controller.Sync(checklist.Id, key, SyncRequest(StartedAt, null, SyncStep(step, text: "Changed")));

        Assert.IsType<ConflictObjectResult>(result.Result);
        dbContext.ChangeTracker.Clear();
        Assert.Equal("Done", (await dbContext.ChecklistRunSteps.SingleAsync()).ResponseText);
    }

    [Fact]
    public async Task Sync_ReturnsTheSavedRun_WhenTheRunIsCompleteAndTheDeviceSendsItCompleteAgain()
    {
        await using var dbContext = CreateDbContext();
        var checklist = await AddChecklistAsync(dbContext, "Daily");
        var step = await AddStepAsync(dbContext, checklist.Id, "Step", type: StepType.Text);
        var controller = CreateController(dbContext);
        var key = Guid.NewGuid();
        var completedAt = StartedAt.AddMinutes(5);
        await controller.Sync(checklist.Id, key, SyncRequest(StartedAt, completedAt, SyncStep(step, text: "Done")));

        var result = await controller.Sync(checklist.Id, key, SyncRequest(StartedAt, completedAt.AddMinutes(1), SyncStep(step, text: "Changed")));

        var run = Assert.IsType<ChecklistRunResponse>(Assert.IsType<OkObjectResult>(result.Result).Value);
        Assert.Equal(completedAt, run.CompletedAt);
        Assert.Equal("Done", Assert.Single(run.Steps).ResponseText);
    }

    [Fact]
    public async Task Sync_ReturnsConflict_WhenTheClientKeyBelongsToARunOfAnotherChecklist()
    {
        await using var dbContext = CreateDbContext();
        var checklist = await AddChecklistAsync(dbContext, "Daily");
        var other = await AddChecklistAsync(dbContext, "Weekly");
        var step = await AddStepAsync(dbContext, checklist.Id, "Step");
        var controller = CreateController(dbContext);
        var key = Guid.NewGuid();
        await controller.Sync(checklist.Id, key, SyncRequest(StartedAt, null, SyncStep(step)));

        var result = await controller.Sync(other.Id, key, SyncRequest(StartedAt, null));

        Assert.IsType<ConflictObjectResult>(result.Result);
        Assert.Equal(checklist.Id, (await dbContext.ChecklistRuns.SingleAsync()).ChecklistId);
    }

    [Fact]
    public async Task Sync_ReturnsNotFound_WhenChecklistDoesNotExist()
    {
        await using var dbContext = CreateDbContext();

        var result = await CreateController(dbContext).Sync(999, Guid.NewGuid(), SyncRequest(StartedAt, null));

        Assert.IsType<NotFoundResult>(result.Result);
        Assert.False(await dbContext.ChecklistRuns.AnyAsync());
    }

    [Fact]
    public async Task Sync_ReturnsValidationProblem_WhenClientKeyIsEmpty()
    {
        await using var dbContext = CreateDbContext();
        var checklist = await AddChecklistAsync(dbContext, "Daily");

        var result = await CreateController(dbContext).Sync(checklist.Id, Guid.Empty, SyncRequest(StartedAt, null));

        Assert.Equal("A client key is required.", GetValidationMessage(result.Result));
        Assert.False(await dbContext.ChecklistRuns.AnyAsync());
    }

    [Fact]
    public async Task Sync_ClampsTimesInTheFuture_ToNow()
    {
        await using var dbContext = CreateDbContext();
        var checklist = await AddChecklistAsync(dbContext, "Daily");
        var step = await AddStepAsync(dbContext, checklist.Id, "Step");
        var future = DateTimeOffset.UtcNow.AddDays(1);
        var before = DateTimeOffset.UtcNow;

        var run = GetRun(await CreateController(dbContext).Sync(
            checklist.Id,
            Guid.NewGuid(),
            SyncRequest(future, future.AddMinutes(5), SyncStep(step, isDone: true, completedAt: future.AddMinutes(1)))));

        var after = DateTimeOffset.UtcNow;
        Assert.InRange(run.StartedAt, before, after);
        Assert.InRange(Assert.Single(run.Steps).CompletedAt!.Value, before, after);
        Assert.InRange(run.CompletedAt!.Value, before, after);
    }

    [Fact]
    public async Task Sync_UsesNow_WhenADoneStepHasNoCompletionTime()
    {
        await using var dbContext = CreateDbContext();
        var checklist = await AddChecklistAsync(dbContext, "Daily");
        var step = await AddStepAsync(dbContext, checklist.Id, "Step");
        var before = DateTimeOffset.UtcNow;

        var run = GetRun(await CreateController(dbContext).Sync(checklist.Id, Guid.NewGuid(), SyncRequest(StartedAt, null, SyncStep(step, isDone: true))));

        Assert.InRange(Assert.Single(run.Steps).CompletedAt!.Value, before, DateTimeOffset.UtcNow);
    }

    [Fact]
    public async Task Sync_ClearsCompletionTime_WhenAStepIsNotDone()
    {
        await using var dbContext = CreateDbContext();
        var checklist = await AddChecklistAsync(dbContext, "Daily");
        var step = await AddStepAsync(dbContext, checklist.Id, "Step");

        // A time on a step that isn't done is a leftover the device didn't clear, so it isn't kept.
        var run = GetRun(await CreateController(dbContext).Sync(checklist.Id, Guid.NewGuid(), SyncRequest(StartedAt, null, SyncStep(step, completedAt: StartedAt.AddMinutes(1)))));

        var runStep = Assert.Single(run.Steps);
        Assert.Equal((false, (DateTimeOffset?)null), (runStep.IsDone, runStep.CompletedAt));
    }

    [Fact]
    public async Task Sync_GivesTheRunToTheCurrentUser()
    {
        await using var dbContext = CreateDbContext();
        var checklist = await AddChecklistAsync(dbContext, "Daily");

        var run = GetRun(await CreateController(dbContext).Sync(checklist.Id, Guid.NewGuid(), SyncRequest(StartedAt, null)));

        Assert.Equal(TestDb.UserId, (await dbContext.ChecklistRuns.SingleAsync(item => item.Id == run.Id)).UserId);
    }

    [Fact]
    public async Task Sync_WithAnotherUsersClientKey_MakesARunOfOurOwn()
    {
        var databaseName = Guid.NewGuid().ToString();
        var key = Guid.NewGuid();
        int theirRunId;
        await using (var otherContext = TestDb.Create(databaseName, TestDb.OtherUserId))
        {
            var theirs = await AddChecklistAsync(otherContext, "Theirs");
            theirRunId = GetRun(await CreateController(otherContext).Sync(theirs.Id, key, SyncRequest(StartedAt, null))).Id;
        }

        await using var dbContext = CreateDbContext(databaseName);
        var checklist = await AddChecklistAsync(dbContext, "Mine");

        var run = GetRun(await CreateController(dbContext).Sync(checklist.Id, key, SyncRequest(StartedAt.AddDays(1), null)));

        Assert.NotEqual(theirRunId, run.Id);
        await using var checkContext = TestDb.Create(databaseName, TestDb.OtherUserId);
        Assert.Equal(StartedAt, (await checkContext.ChecklistRuns.SingleAsync(item => item.Id == theirRunId)).StartedAt);
        Assert.Equal(2, await checkContext.ChecklistRuns.IgnoreQueryFilters().CountAsync());
    }

    [Fact]
    public async Task Sync_ReturnsConflict_WhenAnotherSyncCreatesTheRunFirst()
    {
        var databaseName = Guid.NewGuid().ToString();
        int checklistId;
        ChecklistStep step;
        await using (var setupContext = CreateDbContext(databaseName))
        {
            checklistId = (await AddChecklistAsync(setupContext, "Daily")).Id;
            step = await AddStepAsync(setupContext, checklistId, "Step");
        }

        var key = Guid.NewGuid();
        var request = SyncRequest(StartedAt, null, SyncStep(step, isDone: true, completedAt: StartedAt.AddMinutes(1)));
        await using var otherContext = CreateDbContext(databaseName);
        // Another sync of the same run saves first, so this one's insert fails on the unique key index, which the
        // in-memory database doesn't enforce itself.
        await using var dbContext = CreateDbContext(databaseName, new BeforeSaveInterceptor(async () =>
        {
            Assert.IsType<CreatedAtActionResult>((await CreateController(otherContext).Sync(checklistId, key, request)).Result);
            throw new DbUpdateException("IX_ChecklistRuns_UserId_ClientKey");
        }));

        var result = await CreateController(dbContext).Sync(checklistId, key, request);

        Assert.IsType<ConflictObjectResult>(result.Result);
        await using var checkContext = CreateDbContext(databaseName);
        Assert.Equal(key, (await checkContext.ChecklistRuns.SingleAsync()).ClientKey);
    }

    [Fact]
    public async Task Sync_ReturnsConflict_WhenRunIsCompletedWhileSaving()
    {
        var databaseName = Guid.NewGuid().ToString();
        var (runId, stepId) = await StartRunWithOneStepAsync(databaseName);
        Guid key;
        ChecklistStep step;
        await using (var setupContext = CreateDbContext(databaseName))
        {
            key = (await setupContext.ChecklistRuns.SingleAsync()).ClientKey;
            step = await setupContext.ChecklistSteps.SingleAsync(item => item.Id == stepId);
        }

        await using var otherContext = CreateDbContext(databaseName);
        await using var dbContext = CreateDbContext(databaseName, new BeforeSaveInterceptor(async () =>
            Assert.IsType<OkObjectResult>((await CreateController(otherContext).Complete(runId)).Result)));

        var result = await CreateController(dbContext).Sync(step.ChecklistId, key, SyncRequest(StartedAt, null, SyncStep(step)));

        Assert.IsType<ConflictObjectResult>(result.Result);
        await using var checkContext = CreateDbContext(databaseName);
        Assert.True((await checkContext.ChecklistRunSteps.SingleAsync()).IsDone);
        Assert.NotNull((await checkContext.ChecklistRuns.SingleAsync()).CompletedAt);
    }

    [Fact]
    public async Task Sync_ReturnsNotFound_WhenRunIsDeletedWhileSaving()
    {
        var databaseName = Guid.NewGuid().ToString();
        var (runId, stepId) = await StartRunWithOneStepAsync(databaseName);
        Guid key;
        ChecklistStep step;
        await using (var setupContext = CreateDbContext(databaseName))
        {
            key = (await setupContext.ChecklistRuns.SingleAsync()).ClientKey;
            step = await setupContext.ChecklistSteps.SingleAsync(item => item.Id == stepId);
        }

        await using var otherContext = CreateDbContext(databaseName);
        await using var dbContext = CreateDbContext(databaseName, new BeforeSaveInterceptor(async () =>
            Assert.IsType<NoContentResult>(await CreateController(otherContext).Delete(runId))));

        var result = await CreateController(dbContext).Sync(step.ChecklistId, key, SyncRequest(StartedAt, null, SyncStep(step)));

        Assert.IsType<NotFoundResult>(result.Result);
    }

    [Fact]
    public async Task GetForChecklist_IncludesEachRunsClientKey()
    {
        await using var dbContext = CreateDbContext();
        var checklist = await AddChecklistAsync(dbContext, "Daily");
        var controller = CreateController(dbContext);
        var key = Guid.NewGuid();
        var run = GetRun(await controller.Sync(checklist.Id, key, SyncRequest(StartedAt, null)));

        var result = await controller.GetForChecklist(checklist.Id);

        var runs = Assert.IsType<List<ChecklistRunSummaryResponse>>(Assert.IsType<OkObjectResult>(result.Result).Value);
        Assert.Equal(new ChecklistRunSummaryResponse(run.Id, key, StartedAt, null), Assert.Single(runs));
    }

    private static RunSyncRequest SyncRequest(DateTimeOffset startedAt, DateTimeOffset? completedAt, params RunSyncStepRequest[] steps)
    {
        return new() { StartedAt = startedAt, CompletedAt = completedAt, Steps = steps };
    }

    // The step as a device that saw the checklist step would send it, with the answer given.
    private static RunSyncStepRequest SyncStep(
        ChecklistStep step,
        bool isDone = false,
        DateTimeOffset? completedAt = null,
        string? text = null,
        decimal? number = null,
        int? optionId = null,
        string? optionText = null)
    {
        return new()
        {
            StepId = step.Id,
            Text = step.Text,
            Type = step.Type,
            IsDone = isDone,
            CompletedAt = completedAt,
            ResponseText = text,
            ResponseNumber = number,
            SelectedOptionId = optionId,
            SelectedOptionText = optionText
        };
    }

    private static ValidationProblemDetails GetValidationProblem(ActionResult? result)
    {
        return Assert.IsType<ValidationProblemDetails>(Assert.IsType<ObjectResult>(result).Value);
    }
}
