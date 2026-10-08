using System.Globalization;
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
        var completed = new ChecklistRun { ChecklistId = checklist.Id, StartedAt = startedAt, CompletedAt = startedAt.AddMinutes(5) };
        var inProgress = new ChecklistRun { ChecklistId = checklist.Id, StartedAt = startedAt.AddDays(1) };
        dbContext.ChecklistRuns.AddRange(
            completed,
            inProgress,
            new ChecklistRun { ChecklistId = other.Id, StartedAt = startedAt.AddDays(2) });
        await dbContext.SaveChangesAsync();

        var result = await CreateController(dbContext).GetForChecklist(checklist.Id);

        var runs = Assert.IsType<List<ChecklistRunSummaryResponse>>(Assert.IsType<OkObjectResult>(result.Result).Value);
        Assert.Equal(
            [
                new ChecklistRunSummaryResponse(inProgress.Id, startedAt.AddDays(1), null),
                new ChecklistRunSummaryResponse(completed.Id, startedAt, startedAt.AddMinutes(5)),
            ],
            runs);
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

    [Theory]
    [InlineData("42")]
    [InlineData("-3.5")]
    [InlineData("0")]
    [InlineData("0.000001")]
    [InlineData("999999999.999999")]
    [InlineData("-999999999.999999")]
    public async Task UpdateStep_SavesNumber_ForNumberStep_AndMarksItDone(string value)
    {
        var number = decimal.Parse(value, CultureInfo.InvariantCulture);
        await using var dbContext = CreateDbContext();
        var checklist = await AddChecklistAsync(dbContext, "Daily");
        var step = await AddStepAsync(dbContext, checklist.Id, "Temperature", type: StepType.Number);
        var controller = CreateController(dbContext);
        var runId = GetRun(await controller.Start(checklist.Id)).Id;

        // IsDone and Text are ignored for a number step: only the number decides it.
        var result = await controller.UpdateStep(runId, step.Id, new RunStepRequest { Number = number, Text = "x", IsDone = false });

        var saved = Assert.IsType<ChecklistRunStepResponse>(Assert.IsType<OkObjectResult>(result.Result).Value);
        Assert.Equal(number, saved.ResponseNumber);
        Assert.Null(saved.ResponseText);
        Assert.True(saved.IsDone);
        Assert.NotNull(saved.CompletedAt);
        var reloaded = Assert.Single(GetRun(await controller.GetById(runId)).Steps);
        Assert.Equal((number, true), (reloaded.ResponseNumber, reloaded.IsDone));
    }

    [Fact]
    public async Task UpdateStep_ClearsNumberStep_WhenNumberIsNull()
    {
        await using var dbContext = CreateDbContext();
        var checklist = await AddChecklistAsync(dbContext, "Daily");
        var step = await AddStepAsync(dbContext, checklist.Id, "Temperature", type: StepType.Number);
        var controller = CreateController(dbContext);
        var runId = GetRun(await controller.Start(checklist.Id)).Id;
        await controller.UpdateStep(runId, step.Id, new RunStepRequest { Number = 21.5m });

        var result = await controller.UpdateStep(runId, step.Id, new RunStepRequest { Number = null, IsDone = true });

        var saved = Assert.IsType<ChecklistRunStepResponse>(Assert.IsType<OkObjectResult>(result.Result).Value);
        Assert.Null(saved.ResponseNumber);
        Assert.False(saved.IsDone);
        Assert.Null(saved.CompletedAt);
    }

    [Theory]
    [InlineData("1000000000")]
    [InlineData("-1000000000")]
    [InlineData("1.0000001")]
    // decimal.MinValue and MaxValue: Math.Abs(decimal) can't overflow, unlike Math.Abs(int.MinValue).
    [InlineData("-79228162514264337593543950335")]
    [InlineData("79228162514264337593543950335")]
    public async Task UpdateStep_ReturnsValidationProblem_WhenNumberDoesNotFit(string value)
    {
        var number = decimal.Parse(value, CultureInfo.InvariantCulture);
        await using var dbContext = CreateDbContext();
        var checklist = await AddChecklistAsync(dbContext, "Daily");
        var step = await AddStepAsync(dbContext, checklist.Id, "Temperature", type: StepType.Number);
        var controller = CreateController(dbContext);
        var runId = GetRun(await controller.Start(checklist.Id)).Id;

        var result = await controller.UpdateStep(runId, step.Id, new RunStepRequest { Number = number });

        var objectResult = Assert.IsType<ObjectResult>(result.Result);
        Assert.IsType<ValidationProblemDetails>(objectResult.Value);
        var saved = await dbContext.ChecklistRunSteps.SingleAsync();
        Assert.Null(saved.ResponseNumber);
        Assert.False(saved.IsDone);
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
    public async Task Start_ReturnsChoiceStepsOptionsInOrder()
    {
        await using var dbContext = CreateDbContext();
        var checklist = await AddChecklistAsync(dbContext, "Daily");
        await AddChoiceStepAsync(dbContext, checklist.Id, "Weather", "Sunny", "Rainy");
        await AddStepAsync(dbContext, checklist.Id, "Tick", 1);

        var run = GetRun(await CreateController(dbContext).Start(checklist.Id));

        Assert.Collection(run.Steps,
            step =>
            {
                Assert.Equal(StepType.Choice, step.Type);
                Assert.Equal(["Sunny", "Rainy"], step.Options.Select(option => option.Text));
                Assert.Null(step.SelectedOptionId);
                Assert.Null(step.SelectedOptionText);
            },
            step => Assert.Empty(step.Options));
    }

    [Fact]
    public async Task UpdateStep_SavesPickedOption_ForChoiceStep_AndClearsItWhenNull()
    {
        await using var dbContext = CreateDbContext();
        var checklist = await AddChecklistAsync(dbContext, "Daily");
        var step = await AddChoiceStepAsync(dbContext, checklist.Id, "Weather", "Sunny", "Rainy");
        var rainy = step.Options[1];
        var controller = CreateController(dbContext);
        var runId = GetRun(await controller.Start(checklist.Id)).Id;

        // IsDone is ignored for a choice step: only the option decides it.
        var picked = await controller.UpdateStep(runId, step.Id, new RunStepRequest { OptionId = rainy.Id, IsDone = false });

        var pickedStep = Assert.IsType<ChecklistRunStepResponse>(Assert.IsType<OkObjectResult>(picked.Result).Value);
        Assert.Equal((rainy.Id, "Rainy", true), (pickedStep.SelectedOptionId, pickedStep.SelectedOptionText, pickedStep.IsDone));
        Assert.NotNull(pickedStep.CompletedAt);
        Assert.Equal(2, pickedStep.Options.Count);

        var cleared = await controller.UpdateStep(runId, step.Id, new RunStepRequest { OptionId = null, IsDone = true });

        var clearedStep = Assert.IsType<ChecklistRunStepResponse>(Assert.IsType<OkObjectResult>(cleared.Result).Value);
        Assert.Equal((null, null, false), (clearedStep.SelectedOptionId, clearedStep.SelectedOptionText, clearedStep.IsDone));
        Assert.Null(clearedStep.CompletedAt);
    }

    [Fact]
    public async Task UpdateStep_ReturnsValidationProblem_WhenOptionBelongsToAnotherStep()
    {
        await using var dbContext = CreateDbContext();
        var checklist = await AddChecklistAsync(dbContext, "Daily");
        var step = await AddChoiceStepAsync(dbContext, checklist.Id, "Weather", "Sunny", "Rainy");
        var other = await AddChoiceStepAsync(dbContext, checklist.Id, "Mood", "Happy", "Sad");
        var controller = CreateController(dbContext);
        var runId = GetRun(await controller.Start(checklist.Id)).Id;

        var result = await controller.UpdateStep(runId, step.Id, new RunStepRequest { OptionId = other.Options[0].Id });

        Assert.IsType<ValidationProblemDetails>(Assert.IsType<ObjectResult>(result.Result).Value);
        Assert.All(await dbContext.ChecklistRunSteps.ToListAsync(), runStep => Assert.Null(runStep.SelectedOptionId));
    }

    [Fact]
    public async Task UpdateStep_ReturnsValidationProblem_WhenOptionIsRemovedWhileSaving()
    {
        var databaseName = Guid.NewGuid().ToString();
        int runId;
        ChecklistStep step;

        await using (var setupContext = CreateDbContext(databaseName))
        {
            var checklist = await AddChecklistAsync(setupContext, "Daily");
            step = await AddChoiceStepAsync(setupContext, checklist.Id, "Weather", "Sunny", "Rainy");
            runId = GetRun(await CreateController(setupContext).Start(checklist.Id)).Id;
        }

        var optionId = step.Options[0].Id;
        await using var otherContext = CreateDbContext(databaseName);
        // Another request removes the option after this one has checked it, and SQL Server's foreign key then
        // fails this save. The in-memory provider has no foreign keys, so the failure is thrown here instead.
        await using var dbContext = CreateDbContext(databaseName, new BeforeSaveInterceptor(async () =>
        {
            otherContext.StepOptions.Remove(await otherContext.StepOptions.SingleAsync(option => option.Id == optionId));
            await otherContext.SaveChangesAsync();
            throw new DbUpdateException("FK_ChecklistRunSteps_StepOptions_SelectedOptionId");
        }));

        var result = await CreateController(dbContext).UpdateStep(runId, step.Id, new RunStepRequest { OptionId = optionId });

        Assert.IsType<ValidationProblemDetails>(Assert.IsType<ObjectResult>(result.Result).Value);
    }

    [Fact]
    public async Task UpdateStep_Throws_WhenSavingAPickFailsAndTheOptionStillExists()
    {
        var databaseName = Guid.NewGuid().ToString();
        int runId;
        ChecklistStep step;

        await using (var setupContext = CreateDbContext(databaseName))
        {
            var checklist = await AddChecklistAsync(setupContext, "Daily");
            step = await AddChoiceStepAsync(setupContext, checklist.Id, "Weather", "Sunny", "Rainy");
            runId = GetRun(await CreateController(setupContext).Start(checklist.Id)).Id;
        }

        await using var dbContext = CreateDbContext(databaseName, new BeforeSaveInterceptor(() =>
            throw new DbUpdateException("Something else")));

        await Assert.ThrowsAsync<DbUpdateException>(() =>
            CreateController(dbContext).UpdateStep(runId, step.Id, new RunStepRequest { OptionId = step.Options[0].Id }));
    }

    [Fact]
    public async Task GetById_KeepsPickedOptionText_AfterOptionIsEditedOrRemoved()
    {
        await using var dbContext = CreateDbContext();
        var checklist = await AddChecklistAsync(dbContext, "Daily");
        var step = await AddChoiceStepAsync(dbContext, checklist.Id, "Weather", "Sunny", "Rainy", "Snowy");
        var (sunny, rainy) = (step.Options[0], step.Options[1]);
        var controller = CreateController(dbContext);
        var editedRunId = GetRun(await controller.Start(checklist.Id)).Id;
        var removedRunId = GetRun(await controller.Start(checklist.Id)).Id;
        await controller.UpdateStep(editedRunId, step.Id, new RunStepRequest { OptionId = sunny.Id });
        await controller.UpdateStep(removedRunId, step.Id, new RunStepRequest { OptionId = rainy.Id });
        await controller.Complete(editedRunId);
        await controller.Complete(removedRunId);

        var stepsController = new ChecklistStepsController(dbContext, NullLogger<ChecklistStepsController>.Instance);
        Assert.IsType<OkObjectResult>((await stepsController.Update(checklist.Id, step.Id, new ChecklistStepRequest
        {
            Text = "Weather",
            Type = StepType.Choice,
            Options = [new StepOptionRequest { Id = sunny.Id, Text = "Bright" }, new StepOptionRequest { Text = "Foggy" }]
        })).Result);
        dbContext.ChangeTracker.Clear();

        var edited = Assert.Single(GetRun(await controller.GetById(editedRunId)).Steps);
        var removed = Assert.Single(GetRun(await controller.GetById(removedRunId)).Steps);

        Assert.Equal((sunny.Id, "Sunny", true), (edited.SelectedOptionId, edited.SelectedOptionText, edited.IsDone));
        Assert.Equal((null, "Rainy", true), (removed.SelectedOptionId, removed.SelectedOptionText, removed.IsDone));
        Assert.Equal(["Bright", "Foggy"], removed.Options.Select(option => option.Text));
    }

    [Fact]
    public async Task GetById_SendsAPickOfAnOptionNoLongerOnTheStepAsRemoved()
    {
        var databaseName = Guid.NewGuid().ToString();
        int runId;
        int rainyId;

        await using (var setupContext = CreateDbContext(databaseName))
        {
            var checklist = await AddChecklistAsync(setupContext, "Daily");
            var step = await AddChoiceStepAsync(setupContext, checklist.Id, "Weather", "Sunny", "Rainy");
            rainyId = step.Options[1].Id;
            var controller = CreateController(setupContext);
            runId = GetRun(await controller.Start(checklist.Id)).Id;
            await controller.UpdateStep(runId, step.Id, new RunStepRequest { OptionId = rainyId });
        }

        // The option goes between reading the run and reading the options, so the run still names it. The
        // in-memory provider has no foreign keys, and this context hasn't read the run, so the pick stays.
        await using (var otherContext = CreateDbContext(databaseName))
        {
            otherContext.StepOptions.Remove(await otherContext.StepOptions.SingleAsync(option => option.Id == rainyId));
            await otherContext.SaveChangesAsync();
        }

        await using var dbContext = CreateDbContext(databaseName);
        Assert.Equal(rainyId, (await dbContext.ChecklistRunSteps.SingleAsync()).SelectedOptionId);

        var runStep = Assert.Single(GetRun(await CreateController(dbContext).GetById(runId)).Steps);

        Assert.Equal((null, "Rainy", true), (runStep.SelectedOptionId, runStep.SelectedOptionText, runStep.IsDone));
        Assert.Equal(["Sunny"], runStep.Options.Select(option => option.Text));
    }

    [Fact]
    public async Task GetById_KeepsPickedOptionText_AfterChoiceStepIsDeleted()
    {
        await using var dbContext = CreateDbContext();
        var checklist = await AddChecklistAsync(dbContext, "Daily");
        var step = await AddChoiceStepAsync(dbContext, checklist.Id, "Weather", "Sunny", "Rainy");
        var controller = CreateController(dbContext);
        var runId = GetRun(await controller.Start(checklist.Id)).Id;
        await controller.UpdateStep(runId, step.Id, new RunStepRequest { OptionId = step.Options[0].Id });

        var stepsController = new ChecklistStepsController(dbContext, NullLogger<ChecklistStepsController>.Instance);
        Assert.IsType<NoContentResult>(await stepsController.Delete(checklist.Id, step.Id));
        dbContext.ChangeTracker.Clear();

        var runStep = Assert.Single(GetRun(await controller.GetById(runId)).Steps);
        Assert.Equal((null, null, "Sunny", true), (runStep.StepId, runStep.SelectedOptionId, runStep.SelectedOptionText, runStep.IsDone));
        Assert.Empty(runStep.Options);
        Assert.False(await dbContext.StepOptions.AnyAsync());
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

    [Fact]
    public async Task Start_GivesTheRunToTheCurrentUser()
    {
        await using var dbContext = CreateDbContext();
        var checklist = await AddChecklistAsync(dbContext, "Daily");

        var run = GetRun(await CreateController(dbContext).Start(checklist.Id));

        Assert.Equal(TestDb.UserId, (await dbContext.ChecklistRuns.SingleAsync(item => item.Id == run.Id)).UserId);
    }

    [Fact]
    public async Task OtherUsersRuns_AreNotFoundOrChanged()
    {
        var databaseName = Guid.NewGuid().ToString();
        int checklistId;
        int stepId;
        int runId;
        await using (var otherContext = TestDb.Create(databaseName, TestDb.OtherUserId))
        {
            checklistId = (await AddChecklistAsync(otherContext, "Theirs")).Id;
            stepId = (await AddStepAsync(otherContext, checklistId, "Their step")).Id;
            runId = GetRun(await CreateController(otherContext).Start(checklistId)).Id;
        }

        await using var dbContext = CreateDbContext(databaseName);
        var controller = CreateController(dbContext);

        Assert.IsType<NotFoundResult>((await controller.Start(checklistId)).Result);
        Assert.IsType<NotFoundResult>((await controller.GetForChecklist(checklistId)).Result);
        Assert.IsType<NotFoundResult>((await controller.GetById(runId)).Result);
        Assert.IsType<NotFoundResult>((await controller.UpdateStep(runId, stepId, new RunStepRequest { IsDone = true })).Result);
        Assert.IsType<NotFoundResult>((await controller.Complete(runId)).Result);
        Assert.False((await dbContext.ChecklistRunSteps.SingleAsync()).IsDone);
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

    private static async Task<ChecklistStep> AddChoiceStepAsync(ChecklistDbContext dbContext, int checklistId, string text, params string[] options)
    {
        var step = new ChecklistStep
        {
            ChecklistId = checklistId,
            Text = text,
            Type = StepType.Choice,
            Options = [.. options.Select((option, index) => new StepOption { Text = option, SortOrder = index })]
        };
        dbContext.ChecklistSteps.Add(step);
        await dbContext.SaveChangesAsync();
        return step;
    }

    private static ChecklistDbContext CreateDbContext(string? databaseName = null, params IInterceptor[] interceptors)
    {
        return TestDb.Create(databaseName, TestDb.UserId, interceptors);
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
