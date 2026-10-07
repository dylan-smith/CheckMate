namespace CheckMate.Api.Models;

public static class StepDependencyGraph
{
    private enum VisitState
    {
        InProgress,
        Done
    }

    /// <summary>
    /// Finds a cycle with a depth-first search over the steps each step depends on.
    /// </summary>
    /// <param name="dependsOn">The step IDs each step depends on, keyed by step ID.</param>
    /// <returns>
    /// The steps of a cycle in order, where each depends on the next and the last depends on the first, or null when
    /// there's no cycle.
    /// </returns>
    public static IReadOnlyList<int>? FindCycle(IReadOnlyDictionary<int, IReadOnlyCollection<int>> dependsOn)
    {
        ArgumentNullException.ThrowIfNull(dependsOn);

        var states = new Dictionary<int, VisitState>();
        // The steps the search is inside of, so a step found here again closes a cycle.
        var path = new List<int>();

        foreach (var stepId in dependsOn.Keys)
        {
            if (!states.ContainsKey(stepId) && Visit(stepId) is { } cycle)
            {
                return cycle;
            }
        }

        return null;

        IReadOnlyList<int>? Visit(int stepId)
        {
            states[stepId] = VisitState.InProgress;
            path.Add(stepId);

            if (dependsOn.TryGetValue(stepId, out var prerequisites))
            {
                foreach (var prerequisite in prerequisites)
                {
                    if (states.TryGetValue(prerequisite, out var state))
                    {
                        if (state == VisitState.InProgress)
                        {
                            return path[path.IndexOf(prerequisite)..];
                        }

                        continue;
                    }

                    if (Visit(prerequisite) is { } cycle)
                    {
                        return cycle;
                    }
                }
            }

            path.RemoveAt(path.Count - 1);
            states[stepId] = VisitState.Done;
            return null;
        }
    }
}
