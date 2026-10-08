using CheckMate.Api.Models;

namespace CheckMate.Api.Tests;

public class StepDependencyGraphTests
{
    [Fact]
    public void FindPath_ReturnsNull_ForAnEmptyGraph()
    {
        Assert.Null(StepDependencyGraph.FindPath(Graph(), 1, 2));
    }

    [Fact]
    public void FindPath_ReturnsNull_WhenStepsDoNotDependOnEachOther()
    {
        Assert.Null(StepDependencyGraph.FindPath(Graph((1, []), (2, [])), 1, 2));
    }

    [Fact]
    public void FindPath_FindsADirectDependency()
    {
        Assert.Equal([1, 2], StepDependencyGraph.FindPath(Graph((1, [2]), (2, [])), 1, 2));
    }

    [Fact]
    public void FindPath_FindsAnIndirectDependency()
    {
        Assert.Equal([1, 2, 3], StepDependencyGraph.FindPath(Graph((1, [2]), (2, [3]), (3, [])), 1, 3));
    }

    [Fact]
    public void FindPath_OnlyFollowsDependenciesOneWay()
    {
        // 1 depends on 2, but 2 doesn't depend on 1.
        Assert.Null(StepDependencyGraph.FindPath(Graph((1, [2]), (2, [])), 2, 1));
    }

    [Fact]
    public void FindPath_BacksOutOfABranchThatDoesNotLeadThere()
    {
        // 2 is searched first and leads nowhere, then the path is found through 3.
        Assert.Equal([1, 3, 4], StepDependencyGraph.FindPath(Graph((1, [2, 3]), (2, [5]), (3, [4]), (4, []), (5, [])), 1, 4));
    }

    [Fact]
    public void FindPath_SearchesASharedPrerequisiteOnce()
    {
        // 1 reaches 4 through both 2 and 3 in a diamond, and 4 doesn't lead to 5.
        Assert.Null(StepDependencyGraph.FindPath(Graph((1, [2, 3]), (2, [4]), (3, [4]), (4, []), (5, [])), 1, 5));
    }

    [Fact]
    public void FindPath_StopsAtACycleElsewhere()
    {
        // 2 and 3 depend on each other, which mustn't keep the search going forever.
        Assert.Null(StepDependencyGraph.FindPath(Graph((1, [2]), (2, [3]), (3, [2]), (4, [])), 1, 4));
    }

    [Fact]
    public void FindPath_FindsAPathThroughACycle()
    {
        Assert.Equal([1, 2, 3, 4], StepDependencyGraph.FindPath(Graph((1, [2]), (2, [3]), (3, [2, 4]), (4, [])), 1, 4));
    }

    [Fact]
    public void FindPath_HandlesAPrerequisiteThatIsNotAKey()
    {
        Assert.Equal([1, 2], StepDependencyGraph.FindPath(Graph((1, [2])), 1, 2));
        Assert.Null(StepDependencyGraph.FindPath(Graph((1, [2])), 1, 3));
    }

    private static Dictionary<int, IReadOnlyCollection<int>> Graph(params (int StepId, int[] DependsOn)[] steps)
    {
        return steps.ToDictionary(step => step.StepId, step => (IReadOnlyCollection<int>)step.DependsOn);
    }
}
