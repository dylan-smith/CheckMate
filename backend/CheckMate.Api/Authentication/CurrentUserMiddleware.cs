using CheckMate.Api.Data;
using CheckMate.Api.Models;
using Microsoft.EntityFrameworkCore;

namespace CheckMate.Api.Authentication;

/// <summary>
/// Finds the signed-in user's row, creating it on their first request, and makes it the request's
/// <see cref="CurrentUser"/>.
/// </summary>
public class CurrentUserMiddleware(RequestDelegate next)
{
    public async Task InvokeAsync(HttpContext context, ChecklistDbContext dbContext, CurrentUser currentUser)
    {
        if (context.User.FindFirst(AuthenticationSetup.SubjectClaim)?.Value is { } subject)
        {
            var name = context.User.FindFirst(AuthenticationSetup.NameClaim)?.Value;
            var email = context.User.FindFirst(AuthenticationSetup.EmailClaim)?.Value;
            currentUser.UserId = await GetOrCreateUserIdAsync(dbContext, subject, name, email, context.RequestAborted);
        }

        await next(context);
    }

    public static async Task<int> GetOrCreateUserIdAsync(
        ChecklistDbContext dbContext,
        string subject,
        string? name,
        string? email,
        CancellationToken cancellationToken)
    {
        var user = await dbContext.Users.FirstOrDefaultAsync(item => item.Subject == subject, cancellationToken);

        if (user is null)
        {
            user = new User { Subject = subject, DisplayName = name, Email = email, CreatedAt = DateTimeOffset.UtcNow };
            dbContext.Users.Add(user);

            try
            {
                await dbContext.SaveChangesAsync(cancellationToken);
                return user.Id;
            }
            catch (DbUpdateException)
            {
                // Another request from the same user created the row first, which fails the unique Subject index.
                dbContext.Entry(user).State = EntityState.Detached;
                return await dbContext.Users
                    .AsNoTracking()
                    .Where(item => item.Subject == subject)
                    .Select(item => item.Id)
                    .SingleAsync(cancellationToken);
            }
        }

        // Keep the name and email in step with the account, without writing on every request.
        if ((name is not null && user.DisplayName != name) || (email is not null && user.Email != email))
        {
            user.DisplayName = name ?? user.DisplayName;
            user.Email = email ?? user.Email;
            await dbContext.SaveChangesAsync(cancellationToken);
        }

        return user.Id;
    }
}
