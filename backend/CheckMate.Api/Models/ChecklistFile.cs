using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;
using YamlDotNet.Core;
using YamlDotNet.RepresentationModel;

namespace CheckMate.Api.Models;

/// <summary>
/// Reads and writes the YAML file a checklist is exported to and imported from, so checklists can be shared or kept
/// as a backup. The README describes the format.
/// </summary>
public static partial class ChecklistFile
{
    public const string ContentType = "application/yaml";

    // The version of the file format, so a later change to it can still read older files or explain a newer one.
    private const string FormatVersion = "1";

    private const string Header = "# CheckMate checklist. Import it from the checklists page.";

    public static string FileName(string checklistName)
    {
        var slug = Slugify(checklistName, 60);
        return $"{(slug.Length > 0 ? slug : "checklist")}.yml";
    }

    /// <summary>
    /// Writes a checklist, leaving out what an import would assume anyway (a checkbox step, no options, no
    /// prerequisites) to keep the file short and easy to edit by hand.
    /// </summary>
    /// <param name="steps">The steps in order, with their options and <see cref="ChecklistStep.DependsOn"/> loaded.</param>
    public static string Write(string name, IReadOnlyList<ChecklistStep> steps)
    {
        ArgumentNullException.ThrowIfNull(steps);

        var keys = StepKeys(steps);
        var stepNodes = new YamlSequenceNode();

        foreach (var step in steps)
        {
            var node = new YamlMappingNode();

            if (keys.TryGetValue(step.Id, out var key))
            {
                node.Add("id", key);
            }

            node.Add("text", Text(step.Text));

            if (step.Type != StepType.Checkbox)
            {
                node.Add("type", step.Type.ToString());
            }

            if (step.Options.Count > 0)
            {
                node.Add("options", new YamlSequenceNode(
                    step.Options.OrderBy(option => option.SortOrder).ThenBy(option => option.Id).Select(option => Text(option.Text))));
            }

            var dependsOn = step.DependsOn
                .OrderBy(dependency => dependency.DependsOnStepId)
                .Select(dependency => keys.GetValueOrDefault(dependency.DependsOnStepId))
                .OfType<string>()
                .ToList();

            if (dependsOn.Count > 0)
            {
                node.Add("dependsOn", new YamlSequenceNode(dependsOn.Select(item => new YamlScalarNode(item))));
            }

            stepNodes.Add(node);
        }

        var root = new YamlMappingNode
        {
            { "checkmate", new YamlScalarNode(FormatVersion) },
            { "name", Text(name) },
            { "steps", stepNodes }
        };

        using var writer = new StringWriter(CultureInfo.InvariantCulture);
        writer.Write(Header + "\n");
        // No wrapping, so long step text stays on one line.
        var settings = EmitterSettings.Default.WithBestWidth(int.MaxValue).WithIndentedSequences().WithNewLine("\n");
        new YamlStream(new YamlDocument(root)).Save(new Emitter(writer, settings), assignAnchors: false);
        // The emitter ends the document with "...", which a file of one document doesn't need.
        var yaml = writer.ToString();
        return yaml.EndsWith("...\n", StringComparison.Ordinal) ? yaml[..^4] : yaml;
    }

    /// <summary>
    /// Reads a file made by <see cref="Write"/>, or written by hand in the same format. It only checks the file's
    /// shape: the import checks the rest, such as whether the options suit the step type.
    /// </summary>
    /// <exception cref="ChecklistFileException">The file isn't a checklist this version can read.</exception>
    public static ChecklistImport Read(string text)
    {
        var stream = new YamlStream();
        using var reader = new StringReader(text);

        try
        {
            stream.Load(reader);
        }
        catch (YamlException exception)
        {
            throw new ChecklistFileException($"This file isn't valid YAML. Check line {exception.Start.Line}.", exception);
        }

        if (stream.Documents.Count == 0
            || stream.Documents[0].RootNode is not YamlMappingNode root
            || Child(root, "checkmate") is not YamlScalarNode version)
        {
            throw new ChecklistFileException("This file isn't a CheckMate checklist.");
        }

        if (version.Value != FormatVersion)
        {
            throw new ChecklistFileException("This checklist file is from a newer version of CheckMate, so it can't be imported.");
        }

        if (AsText(Child(root, "name")) is not { } name || name.Trim().Length == 0)
        {
            throw new ChecklistFileException("The checklist file must have a name.");
        }

        var steps = Child(root, "steps") switch
        {
            null => [],
            YamlSequenceNode sequence => sequence.Children.Select(ReadStep).ToList(),
            _ => throw new ChecklistFileException("The checklist file's steps must be a list.")
        };

        return new ChecklistImport { Name = name, Steps = steps };
    }

    private static ChecklistImportStep ReadStep(YamlNode node, int index)
    {
        var label = $"Step {index + 1}";

        // A step can be just its text, for a checkbox step nothing depends on.
        if (AsText(node) is { } shorthand)
        {
            return new ChecklistImportStep { Text = shorthand };
        }

        if (node is not YamlMappingNode step || AsText(Child(step, "text")) is not { } text)
        {
            throw new ChecklistFileException($"{label} needs text.");
        }

        var type = StepType.Checkbox;

        // Only a type's name is accepted, not the number it's stored as.
        if (Child(step, "type") is { } typeNode
            && (!Enum.TryParse(AsText(typeNode), ignoreCase: true, out type) || !Enum.IsDefined(type)
                || int.TryParse(AsText(typeNode), CultureInfo.InvariantCulture, out _)))
        {
            throw new ChecklistFileException($"{label} has an unknown type. Use Checkbox, Text, Number or Choice.");
        }

        string? id = null;

        if (Child(step, "id") is { } idNode)
        {
            id = AsText(idNode) ?? throw new ChecklistFileException($"{label}'s id must be text.");
        }

        return new ChecklistImportStep
        {
            Id = id,
            Text = text,
            Type = type,
            Options = AsTextList(Child(step, "options"), $"{label}'s options"),
            DependsOn = AsTextList(Child(step, "dependsOn"), $"{label}'s dependsOn")
        };
    }

    // The value for a key, or null when it's missing or written as null.
    private static YamlNode? Child(YamlMappingNode node, string key)
    {
        return node.Children.TryGetValue(new YamlScalarNode(key), out var child) && !IsNull(child) ? child : null;
    }

    // Quotes text that would otherwise read back as null, such as a step called "null".
    private static YamlScalarNode Text(string text)
    {
        var node = new YamlScalarNode(text);

        if (IsNull(node))
        {
            node.Style = ScalarStyle.DoubleQuoted;
        }

        return node;
    }

    private static bool IsNull(YamlNode node)
    {
        return node is YamlScalarNode { Style: ScalarStyle.Plain or ScalarStyle.Any, Value: null or "" or "~" or "null" or "Null" or "NULL" };
    }

    private static string? AsText(YamlNode? node)
    {
        return node is YamlScalarNode scalar && !IsNull(scalar) ? scalar.Value : null;
    }

    // A list of text, where a single item can be written without the list.
    private static List<string>? AsTextList(YamlNode? node, string what)
    {
        if (node is null)
        {
            return null;
        }

        var items = node is YamlSequenceNode sequence ? sequence.Children : [node];
        return [.. items.Select(item => AsText(item) ?? throw new ChecklistFileException($"{what} must be a list of text."))];
    }

    // Only steps that others depend on need an id in the file. Each is made from the step's text, numbered when
    // another step's text makes the same one.
    private static Dictionary<int, string> StepKeys(IReadOnlyList<ChecklistStep> steps)
    {
        var needed = steps.SelectMany(step => step.DependsOn).Select(dependency => dependency.DependsOnStepId).ToHashSet();
        var used = new HashSet<string>();
        var keys = new Dictionary<int, string>();

        for (var index = 0; index < steps.Count; index++)
        {
            if (!needed.Contains(steps[index].Id))
            {
                continue;
            }

            var slug = Slugify(steps[index].Text, 40);
            var baseKey = slug.Length > 0 ? slug : $"step-{index + 1}";
            var key = baseKey;

            for (var number = 2; !used.Add(key); number++)
            {
                key = $"{baseKey}-{number}";
            }

            keys[steps[index].Id] = key;
        }

        return keys;
    }

    // A lowercase, dash-separated version of the text that's safe in a file name or as a step's id, or "" when the
    // text has no letters or digits.
    private static string Slugify(string text, int maxLength)
    {
        var withoutAccents = new string([.. text.Normalize(NormalizationForm.FormD)
            .Where(character => CharUnicodeInfo.GetUnicodeCategory(character) != UnicodeCategory.NonSpacingMark)]);
        var slug = NotLetterOrDigit().Replace(withoutAccents.ToLowerInvariant(), "-").TrimStart('-');
        return slug[..Math.Min(slug.Length, maxLength)].TrimEnd('-');
    }

    [GeneratedRegex("[^a-z0-9]+")]
    private static partial Regex NotLetterOrDigit();
}

/// <summary>A problem with a checklist file, which the user can fix by choosing or editing another one.</summary>
public class ChecklistFileException : Exception
{
    public ChecklistFileException()
    {
    }

    public ChecklistFileException(string message)
        : base(message)
    {
    }

    public ChecklistFileException(string message, Exception innerException)
        : base(message, innerException)
    {
    }
}
