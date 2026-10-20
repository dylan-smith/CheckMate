using CheckMate.Api.Models;

namespace CheckMate.Api.Tests;

public class ChecklistFileTests
{
    private static ChecklistStep Step(int id, string text, StepType type = StepType.Checkbox, string[]? options = null, int[]? dependsOn = null)
    {
        return new ChecklistStep
        {
            Id = id,
            Text = text,
            Type = type,
            SortOrder = id,
            Options = [.. (options ?? []).Select((option, index) => new StepOption { Id = index + 1, Text = option, SortOrder = index })],
            DependsOn = [.. (dependsOn ?? []).Select(stepId => new StepDependency { StepId = id, DependsOnStepId = stepId })]
        };
    }

    private static readonly ChecklistStep[] PreFlight =
    [
        Step(10, "Walk around the aircraft"),
        Step(11, "Fuel on board", StepType.Number),
        Step(12, "Weather", StepType.Choice, ["Clear", "Rain"]),
        Step(13, "Take off", dependsOn: [12, 10])
    ];

    [Fact]
    public void Write_LeavesOutDefaults_AndOnlyGivesDependedOnStepsAnId()
    {
        Assert.Equal(
            """
            # CheckMate checklist. Import it from the checklists page.
            checkmate: 1
            name: Pre-flight
            steps:
              - id: walk-around-the-aircraft
                text: Walk around the aircraft
              - text: Fuel on board
                type: Number
              - id: weather
                text: Weather
                type: Choice
                options:
                  - Clear
                  - Rain
              - text: Take off
                dependsOn:
                  - walk-around-the-aircraft
                  - weather

            """.ReplaceLineEndings("\n"),
            ChecklistFile.Write("Pre-flight", PreFlight));
    }

    [Fact]
    public void Write_NumbersIdsThatWouldClash_AndNamesStepsWhoseTextMakesNoId()
    {
        var yaml = ChecklistFile.Write("Repeats", [Step(1, "Check"), Step(2, "check!"), Step(3, "✓✓"), Step(4, "Done", dependsOn: [1, 2, 3])]);

        Assert.Equal(["check", "check-2", "step-3", null], ChecklistFile.Read(yaml).Steps.Select(step => step.Id));
    }

    [Fact]
    public void Write_QuotesTextThatWouldReadBackAsSomethingElse()
    {
        var steps = ChecklistFile.Read(ChecklistFile.Write("123", [Step(1, "null"), Step(2, "- dash: and colon"), Step(3, "42")])).Steps;

        Assert.Equal(["null", "- dash: and colon", "42"], steps.Select(step => step.Text));
    }

    [Fact]
    public void Read_ReadsBackWhatWriteWrote()
    {
        var file = ChecklistFile.Read(ChecklistFile.Write("Pre-flight", PreFlight));

        Assert.Equal("Pre-flight", file.Name);
        Assert.Collection(file.Steps,
            step => Assert.Equal(("walk-around-the-aircraft", "Walk around the aircraft", StepType.Checkbox), (step.Id, step.Text, step.Type)),
            step => Assert.Equal((null, "Fuel on board", StepType.Number), (step.Id, step.Text, step.Type)),
            step =>
            {
                Assert.Equal(("weather", StepType.Choice), (step.Id, step.Type));
                Assert.Equal(["Clear", "Rain"], step.Options);
            },
            step => Assert.Equal(["walk-around-the-aircraft", "weather"], step.DependsOn));
    }

    [Fact]
    public void Read_AcceptsHandWrittenShorthand()
    {
        var file = ChecklistFile.Read("""
            checkmate: 1
            name: Quick
            steps:
              - Just a checkbox
              - id: 7
                text: 42
                type: choice
                options: [Yes, No]
              - text: Last
                dependsOn: 7
            """);

        Assert.Collection(file.Steps,
            step => Assert.Equal(("Just a checkbox", StepType.Checkbox), (step.Text, step.Type)),
            step =>
            {
                Assert.Equal(("7", "42", StepType.Choice), (step.Id, step.Text, step.Type));
                Assert.Equal(["Yes", "No"], step.Options);
            },
            step => Assert.Equal(["7"], step.DependsOn));
    }

    [Theory]
    [InlineData("checkmate: 1\nname: a: b", "This file isn't valid YAML. Check line 2.")]
    [InlineData("", "This file isn't a CheckMate checklist.")]
    [InlineData("name: No version\nsteps: []", "This file isn't a CheckMate checklist.")]
    [InlineData("just text", "This file isn't a CheckMate checklist.")]
    [InlineData("checkmate: 2\nname: Future", "This checklist file is from a newer version of CheckMate, so it can't be imported.")]
    [InlineData("checkmate: 1\nname: \"  \"", "The checklist file must have a name.")]
    [InlineData("checkmate: 1\nname:", "The checklist file must have a name.")]
    [InlineData("checkmate: 1\nname: A\nsteps: nope", "The checklist file's steps must be a list.")]
    [InlineData("checkmate: 1\nname: A\nsteps:\n  - type: Number", "Step 1 needs text.")]
    [InlineData("checkmate: 1\nname: A\nsteps:\n  - text: A\n    type: Date", "Step 1 has an unknown type. Use Checkbox, Text, Number or Choice.")]
    [InlineData("checkmate: 1\nname: A\nsteps:\n  - text: A\n    type: 3", "Step 1 has an unknown type. Use Checkbox, Text, Number or Choice.")]
    [InlineData("checkmate: 1\nname: A\nsteps:\n  - text: A\n    id: [x]", "Step 1's id must be text.")]
    [InlineData("checkmate: 1\nname: A\nsteps:\n  - text: A\n    options: [{ a: 1 }]", "Step 1's options must be a list of text.")]
    public void Read_ExplainsWhatIsWrong(string text, string message)
    {
        var exception = Assert.Throws<ChecklistFileException>(() => ChecklistFile.Read(text));

        Assert.Equal(message, exception.Message);
    }

    [Theory]
    [InlineData("Pre-flight checks", "pre-flight-checks.yml")]
    [InlineData("Café / Bar", "cafe-bar.yml")]
    [InlineData("!!!", "checklist.yml")]
    public void FileName_IsMadeFromTheChecklistName(string name, string fileName)
    {
        Assert.Equal(fileName, ChecklistFile.FileName(name));
    }
}
