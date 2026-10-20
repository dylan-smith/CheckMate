using CheckMate.Api.Data;
using CheckMate.Api.Models;
using Microsoft.EntityFrameworkCore;

namespace CheckMate.Api.Authentication;

/// <summary>
/// Finds the signed-in user's row, creating it on their first request, and makes it the request's
/// <see cref="CurrentUser"/>. A new user also gets the <see cref="StarterChecklist"/>.
/// </summary>
public class CurrentUserMiddleware(RequestDelegate next, ILogger<CurrentUserMiddleware> logger)
{
    public async Task InvokeAsync(HttpContext context, ChecklistDbContext dbContext, CurrentUser currentUser)
    {
        if (context.User.FindFirst(AuthenticationSetup.SubjectClaim)?.Value is { } subject)
        {
            var name = context.User.FindFirst(AuthenticationSetup.NameClaim)?.Value;
            var email = context.User.FindFirst(AuthenticationSetup.EmailClaim)?.Value;
            currentUser.UserId = await GetOrCreateUserIdAsync(dbContext, currentUser, subject, name, email, context.RequestAborted);
        }

        await next(context);
    }

    private async Task<int> GetOrCreateUserIdAsync(
        ChecklistDbContext dbContext,
        CurrentUser currentUser,
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

            // The service account only checks and tidies up after CI, so it has no use for an example.
            if (subject != LocalTokenHandler.ServiceSubject)
            {
                await AddStarterChecklistAsync(dbContext, currentUser, user.Id, cancellationToken);
            }

            return user.Id;
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

    private async Task AddStarterChecklistAsync(
        ChecklistDbContext dbContext,
        CurrentUser currentUser,
        int userId,
        CancellationToken cancellationToken)
    {
        // The context gives new checklists the current user, who is only known once the user's row is saved.
        currentUser.UserId = userId;

        try
        {
            var checklist = StarterChecklist.AddTo(dbContext);
            await dbContext.SaveChangesAsync(cancellationToken);
            logger.LogInformation("Gave new user {UserId} starter checklist {ChecklistId}", userId, checklist.Id);
        }
        catch (Exception exception) when (exception is not OperationCanceledException)
        {
            // Signing in matters more than the example, so carry on without it.
            dbContext.ChangeTracker.Clear();
            logger.LogWarning(exception, "Couldn't give new user {UserId} the starter checklist", userId);
        }
    }
}
