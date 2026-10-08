namespace CheckMate.Api.Models;

public class User
{
    public int Id { get; set; }

    /// <summary>
    /// The signed-in identity, prefixed with where it came from, such as "google:&lt;sub&gt;".
    /// </summary>
    public string Subject { get; set; } = string.Empty;

    public string? Email { get; set; }

    public string? DisplayName { get; set; }

    public DateTimeOffset CreatedAt { get; set; }
}
