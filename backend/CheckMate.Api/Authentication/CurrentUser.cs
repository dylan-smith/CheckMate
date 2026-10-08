namespace CheckMate.Api.Authentication;

/// <summary>
/// The signed-in user of the current request, set by <see cref="CurrentUserMiddleware"/>. Null when nobody is signed in,
/// in which case no checklists or runs are visible.
/// </summary>
public class CurrentUser
{
    public int? UserId { get; set; }
}
