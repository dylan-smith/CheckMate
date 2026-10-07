using CheckMate.Api.Models;

namespace CheckMate.Api.Tests;

public class StepDependencyGraphTests
{
    [Fact]
    public void FindCycle_ReturnsNull_ForAnEmptyGraph()
    {
        Assert.Null(StepDependencyGraph.FindCycle(Graph()));
    }

    [Fact]
    public void FindCycle_ReturnsNull_ForStepsWithoutDependencies()
    {
        Assert.Null(StepDependencyGraph.FindCycle(Graph((1, []), (2, []), (3, []))));
    }

    [Fact]
    public void FindCycle_ReturnsNull_ForAChain()
    {
        Assert.Null(StepDependencyGraph.FindCycle(Graph((1, [2]), (2, [3]), (3, []))));
    }

    [Fact]
    public void FindCycle_ReturnsNull_ForADiamond()
    {
        // 1 depends on 2 and 3, which both depend on 4, so 4 is reached twice without a cycle.
        Assert.Null(StepDependencyGraph.FindCycle(Graph((1, [2, 3]), (2, [4]), (3, [4]), (4, []))));
    }

    [Fact]
    public void FindCycle_ReturnsNull_ForAPrerequisiteThatIsNotAKey()
    {
        Assert.Null(StepDependencyGraph.FindCycle(Graph((1, [2]))));
    }

    [Fact]
    public void FindCycle_FindsAStepThatDependsOnItself()
    {
        Assert.Equal([1], StepDependencyGraph.FindCycle(Graph((1, [1]))));
    }

    [Fact]
    public void FindCycle_FindsTwoStepsThatDependOnEachOther()
    {
        Assert.Equal([1, 2], StepDependencyGraph.FindCycle(Graph((1, [2]), (2, [1]))));
    }

    [Fact]
    public void FindCycle_FindsAnIndirectCycle()
    {
        Assert.Equal([1, 2, 3], StepDependencyGraph.FindCycle(Graph((1, [2]), (2, [3]), (3, [1]))));
    }

    [Fact]
    public void FindCycle_ReturnsOnlyTheStepsInTheCycle()
    {
        // 1 leads into the cycle 2 → 3 → 4 → 2 but isn't part of it.
        Assert.Equal([2, 3, 4], StepDependencyGraph.FindCycle(Graph((1, [2]), (2, [3]), (3, [4]), (4, [2]))));
    }

    [Fact]
    public void FindCycle_FindsACycleReachedAfterAFinishedBranch()
    {
        // 2 is searched fully first and has no cycle, then the cycle is found through 3.
        Assert.Equal([3, 4], StepDependencyGraph.FindCycle(Graph((1, [2, 3]), (2, [5]), (3, [4]), (4, [3, 5]), (5, []))));
    }

    [Fact]
    public void FindCycle_FindsACycleInALaterComponent()
    {
        Assert.Equal([3, 4], StepDependencyGraph.FindCycle(Graph((1, [2]), (2, []), (3, [4]), (4, [3]))));
    }

    private static Dictionary<int, IReadOnlyCollection<int>> Graph(params (int StepId, int[] DependsOn)[] steps)
    {
        return steps.ToDictionary(step => step.StepId, step => (IReadOnlyCollection<int>)step.DependsOn);
    }
}
