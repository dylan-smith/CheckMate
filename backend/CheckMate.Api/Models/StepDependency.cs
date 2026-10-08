namespace CheckMate.Api.Models;

/// <summary>An edge in a checklist's dependency graph: the step can't be done until the step it depends on is.</summary>
public class StepDependency
{
    public int StepId { get; set; }

    public int DependsOnStepId { get; set; }
}
