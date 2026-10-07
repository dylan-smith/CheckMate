using System.Text.Json.Serialization;

namespace CheckMate.Api.Models;

/// <summary>
/// What a step asks for when a checklist is filled out. The database stores the number and the API sends the name,
/// so each value is set explicitly and must never change once shipped.
/// </summary>
[JsonConverter(typeof(StepTypeJsonConverter))]
public enum StepType
{
    /// <summary>Ticked to mark it done.</summary>
    Checkbox = 0,

    /// <summary>Done once some text has been entered.</summary>
    Text = 1
}

/// <summary>Reads and writes a <see cref="StepType"/> by name only, so a number such as 1 is rejected.</summary>
public sealed class StepTypeJsonConverter() : JsonStringEnumConverter<StepType>(allowIntegerValues: false);
