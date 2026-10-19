namespace CheckMate.Api.Models;

/// <summary>
/// Checks a checklist read by <see cref="ChecklistFile.Read"/> and makes its steps, for an import and for the starter
/// checklist new users get.
/// </summary>
public static class ChecklistImportRules
{
    // Limits on an imported checklist file, matching what the step endpoints allow (see ChecklistStepRequest).
    public const int MaxImportSteps = 500;
    public const int MaxStepTextLength = 500;
    public const int MaxStepIdLength = 100;
    public const int MaxOptions = 50;
    public const int MaxOptionTextLength = 200;

    /// <summary>
    /// Checks the imported steps and makes them, with their options and prerequisites. Prerequisites name other steps
    /// by the file's own IDs.
    /// </summary>
    /// <param name="errors">Gets a message for each problem found.</param>
    /// <returns>The steps in order, or null when there were problems.</returns>
    public static List<ChecklistStep>? BuildSteps(IReadOnlyList<ChecklistImportStep> requested, ICollection<string> errors)
    {
        ArgumentNullException.ThrowIfNull(requested);
        ArgumentNullException.ThrowIfNull(errors);

        var steps = new List<ChecklistStep>();
        var indexById = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
        var errorCount = errors.Count;

        if (requested.Count > MaxImportSteps)
        {
            errors.Add($"A checklist file can have at most {MaxImportSteps} steps.");
            return null;
        }

        for (var index = 0; index < requested.Count; index++)
        {
            var item = requested[index];
            var prefix = $"Step {index + 1}: ";
            var text = item.Text.Trim();
            var options = item.Options ?? [];

            if (text.Length == 0)
            {
                errors.Add(prefix + "Step text is required.");
            }
            else if (text.Length > MaxStepTextLength)
            {
                errors.Add(prefix + $"Step text can be at most {MaxStepTextLength} characters.");
            }
            else if (options.Count > MaxOptions)
            {
                errors.Add(prefix + $"A step can have at most {MaxOptions} options.");
            }
            else if (StepOptionRules.Validate(item.Type, options) is { } optionError)
            {
                errors.Add(prefix + optionError);
            }
            else if (options.Any(option => option.Trim().Length > MaxOptionTextLength))
            {
                errors.Add(prefix + $"Option text can be at most {MaxOptionTextLength} characters.");
            }

            if (item.Id is not null)
            {
                var id = item.Id.Trim();

                if (id.Length == 0)
                {
                    errors.Add(prefix + "A step's id can't be empty.");
                }
                else if (id.Length > MaxStepIdLength)
                {
                    errors.Add(prefix + $"A step's id can be at most {MaxStepIdLength} characters.");
                }
                else if (!indexById.TryAdd(id, index))
                {
                    errors.Add(prefix + $"Another step already has the id '{id}'.");
                }
            }

            steps.Add(new ChecklistStep
            {
                Text = text,
                Type = item.Type,
                SortOrder = index,
                Options = [.. options.Select((option, optionIndex) => new StepOption { Text = option.Trim(), SortOrder = optionIndex })]
            });
        }

        if (errors.Count > errorCount)
        {
            return null;
        }

        var graph = new Dictionary<int, IReadOnlyCollection<int>>();

        for (var index = 0; index < requested.Count; index++)
        {
            var prerequisites = new HashSet<int>();

            foreach (var id in (requested[index].DependsOn ?? []).Select(dependsOn => dependsOn.Trim()))
            {
                if (!indexById.TryGetValue(id, out var prerequisite))
                {
                    errors.Add($"Step {index + 1} depends on '{id}', which isn't the id of any step.");
                }
                else if (prerequisite == index)
                {
                    errors.Add($"Step {index + 1}: A step can't depend on itself.");
                }
                else
                {
                    prerequisites.Add(prerequisite);
                }
            }

            graph[index] = prerequisites;
        }

        if (errors.Count > errorCount)
        {
            return null;
        }

        // A step is in a loop when one of its prerequisites leads back to it.
        foreach (var (index, prerequisites) in graph)
        {
            foreach (var prerequisite in prerequisites)
            {
                if (StepDependencyGraph.FindPath(graph, prerequisite, index) is { } path)
                {
                    var loop = path.Prepend(index).Select(stepIndex => $"\"{steps[stepIndex].Text}\"");
                    errors.Add($"Steps can't depend on each other in a loop: {string.Join(" depends on ", loop)}.");
                    return null;
                }
            }
        }

        for (var index = 0; index < steps.Count; index++)
        {
            steps[index].DependsOn = [.. graph[index].Order().Select(prerequisite => new StepDependency { DependsOnStep = steps[prerequisite] })];
        }

        return steps;
    }
}
