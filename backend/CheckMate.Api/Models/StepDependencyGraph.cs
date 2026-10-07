namespace CheckMate.Api.Models;

public static class StepDependencyGraph
{
    /// <summary>
    /// Finds a chain of dependencies from one step to another with a depth-first search. A step that would newly
    /// depend on <paramref name="fromStepId"/> makes a cycle exactly when such a chain leads back to it.
    /// </summary>
    /// <param name="dependsOn">The step IDs each step depends on, keyed by step ID.</param>
    /// <returns>
    /// The steps of the chain in order, starting with <paramref name="fromStepId"/> and ending with
    /// <paramref name="toStepId"/>, where each depends on the next, or null when there's no such chain.
    /// </returns>
    public static IReadOnlyList<int>? FindPath(IReadOnlyDictionary<int, IReadOnlyCollection<int>> dependsOn, int fromStepId, int toStepId)
    {
        ArgumentNullException.ThrowIfNull(dependsOn);

        // Steps already searched, so a cycle elsewhere in the graph can't make the search go round forever.
        var visited = new HashSet<int>();
        var path = new List<int>();

        return Visit(fromStepId) ? path : null;

        bool Visit(int stepId)
        {
            path.Add(stepId);

            if (stepId == toStepId)
            {
                return true;
            }

            if (visited.Add(stepId) && dependsOn.TryGetValue(stepId, out var prerequisites))
            {
                foreach (var prerequisite in prerequisites)
                {
                    if (Visit(prerequisite))
                    {
                        return true;
                    }
                }
            }

            path.RemoveAt(path.Count - 1);
            return false;
        }
    }
}
