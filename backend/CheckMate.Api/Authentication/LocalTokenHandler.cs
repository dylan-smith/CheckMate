using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using System.Text.Encodings.Web;
using Microsoft.AspNetCore.Authentication;
using Microsoft.Extensions.Options;

namespace CheckMate.Api.Authentication;

public class LocalTokenOptions : AuthenticationSchemeOptions
{
    /// <summary>
    /// Accepts "test:&lt;name&gt;" tokens, which sign in as that name without a password. Only for local development,
    /// E2E tests and pull request previews, where Google sign-in can't work. Never turn it on in production.
    /// </summary>
    public bool AllowTestSignIn { get; set; }

    /// <summary>
    /// A secret that signs in as the service user, so the production smoke tests and load test can use the API.
    /// Empty turns it off.
    /// </summary>
    public string? ServiceToken { get; set; }
}

/// <summary>
/// Signs in with the bearer tokens CheckMate issues itself: test sign-ins and the service token.
/// </summary>
public class LocalTokenHandler(IOptionsMonitor<LocalTokenOptions> options, ILoggerFactory logger, UrlEncoder encoder)
    : AuthenticationHandler<LocalTokenOptions>(options, logger, encoder)
{
    public const string SchemeName = "LocalToken";

    public const string TestTokenPrefix = "test:";

    public const string ServiceSubject = "service:ci";

    protected override Task<AuthenticateResult> HandleAuthenticateAsync()
    {
        if (AuthenticationSetup.ReadBearerToken(Request) is not { } token)
        {
            return Task.FromResult(AuthenticateResult.NoResult());
        }

        if (token.StartsWith(TestTokenPrefix, StringComparison.Ordinal))
        {
            if (!Options.AllowTestSignIn)
            {
                return Task.FromResult(AuthenticateResult.Fail("Test sign-in isn't enabled."));
            }

            var name = token[TestTokenPrefix.Length..].Trim();

            return name.Length is 0 or > 100
                ? Task.FromResult(AuthenticateResult.Fail("A test sign-in needs a name of up to 100 characters."))
                : Task.FromResult(Success($"test:{name.ToLowerInvariant()}", name, email: null));
        }

        return IsServiceToken(token, Options.ServiceToken)
            ? Task.FromResult(Success(ServiceSubject, "CheckMate Service", email: null))
            : Task.FromResult(AuthenticateResult.Fail("The token isn't valid."));
    }

    public static bool IsServiceToken(string token, string? serviceToken)
    {
        return !string.IsNullOrEmpty(serviceToken)
            && CryptographicOperations.FixedTimeEquals(Encoding.UTF8.GetBytes(token), Encoding.UTF8.GetBytes(serviceToken));
    }

    private AuthenticateResult Success(string subject, string name, string? email)
    {
        var principal = new ClaimsPrincipal(AuthenticationSetup.CreateIdentity(Scheme.Name, subject, name, email));
        return AuthenticateResult.Success(new AuthenticationTicket(principal, Scheme.Name));
    }
}
