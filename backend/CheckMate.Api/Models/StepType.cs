using System.Text.Json.Serialization;

namespace CheckMate.Api.Models;

/// <summary>What a step asks for when a checklist is filled out. Stored and sent by name.</summary>
[JsonConverter(typeof(JsonStringEnumConverter<StepType>))]
public enum StepType
{
    /// <summary>Ticked to mark it done.</summary>
    Checkbox,

    /// <summary>Done once some text has been entered.</summary>
    Text,

    /// <summary>Done once a number has been entered.</summary>
    Number
}
