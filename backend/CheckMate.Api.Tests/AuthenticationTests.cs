using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using CheckMate.Api.Data;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace CheckMate.Api.Tests;

public class AuthenticationTests(WebApplicationFactory<Program> factory)
    : IClassFixture<WebApplicationFactory<Program>>
{
    private const string ServiceToken = "service-token-for-tests";

    [Fact]
    public async Task Health_AllowsAnonymousRequests()
    {
        using var client = CreateClient();

        var response = await client.GetAsync("/health");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Fact]
    public async Task Api_ReturnsUnauthorized_WithoutToken()
    {
        using var client = CreateClient();

        var response = await client.GetAsync("/api/checklists");

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Api_ReturnsUnauthorized_ForUnknownToken()
    {
        using var client = CreateClient(token: "not-a-real-token");

        var response = await client.GetAsync("/api/checklists");

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task TestSignIn_CreatesTheUserOnce_AndReturnsThem()
    {
        var name = $"Alice {Guid.NewGuid()}";
        var webFactory = CreateFactory();
        using var client = CreateClient(webFactory, $"test:{name}");

        var first = await client.GetFromJsonAsync<MeResponse>("/api/me");
        var second = await client.GetFromJsonAsync<MeResponse>("/api/me");

        Assert.Equal(name, first!.DisplayName);
        Assert.Equal(name, second!.DisplayName);
        using var scope = webFactory.Services.CreateScope();
        var dbContext = scope.ServiceProvider.GetRequiredService<ChecklistDbContext>();
        var subject = $"test:{name.ToLowerInvariant()}";
        Assert.Equal(1, await dbContext.Users.CountAsync(user => user.Subject == subject));
    }

    [Fact]
    public async Task NewUser_GetsTheStarterChecklistOnce()
    {
        var webFactory = CreateFactory();
        using var client = CreateClient(webFactory, $"test:Newcomer {Guid.NewGuid()}");

        var first = await client.GetFromJsonAsync<List<ChecklistResponse>>("/api/checklists");
        var second = await client.GetFromJsonAsync<List<ChecklistResponse>>("/api/checklists");

        var starter = Assert.Single(first!);
        Assert.Equal("Gemini CCR Build", starter.Name);
        Assert.Equal(starter.Id, Assert.Single(second!).Id);
        var detail = await client.GetFromJsonAsync<ChecklistDetailResponse>($"/api/checklists/{starter.Id}");
        Assert.Equal(26, detail!.Steps.Count);
    }

    [Fact]
    public async Task ServiceUser_DoesNotGetTheStarterChecklist()
    {
        var webFactory = CreateFactory(serviceToken: ServiceToken);
        using var client = CreateClient(webFactory, ServiceToken);

        await client.GetFromJsonAsync<MeResponse>("/api/me");

        using var scope = webFactory.Services.CreateScope();
        var dbContext = scope.ServiceProvider.GetRequiredService<ChecklistDbContext>();
        var serviceUser = await dbContext.Users.SingleAsync(user => user.Subject == "service:ci");
        Assert.False(await dbContext.Checklists.IgnoreQueryFilters().AnyAsync(checklist => checklist.UserId == serviceUser.Id));
    }

    [Fact]
    public async Task TestSignIn_IsRejected_WhenNotEnabled()
    {
        using var client = CreateClient(CreateFactory(allowTestSignIn: false), "test:Alice");

        var response = await client.GetAsync("/api/checklists");

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task ServiceToken_SignsInAsTheServiceUser()
    {
        using var client = CreateClient(CreateFactory(serviceToken: ServiceToken), ServiceToken);

        var response = await client.GetFromJsonAsync<MeResponse>("/api/me");

        Assert.Equal("CheckMate Service", response!.DisplayName);
    }

    [Fact]
    public async Task ServiceToken_IsRejected_WhenNotConfigured()
    {
        using var client = CreateClient(token: ServiceToken);

        var response = await client.GetAsync("/api/checklists");

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Users_OnlySeeTheirOwnChecklists()
    {
        var webFactory = CreateFactory();
        using var alice = CreateClient(webFactory, $"test:Alice {Guid.NewGuid()}");
        using var bob = CreateClient(webFactory, $"test:Bob {Guid.NewGuid()}");
        var created = await alice.PostAsJsonAsync("/api/checklists", new { name = "Morning" });
        var checklist = await created.Content.ReadFromJsonAsync<IdResponse>();

        // Both can use the same name, because names only have to be unique per user.
        Assert.Equal(HttpStatusCode.Created, (await bob.PostAsJsonAsync("/api/checklists", new { name = "Morning" })).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await bob.GetAsync($"/api/checklists/{checklist!.Id}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await bob.PostAsync($"/api/checklists/{checklist.Id}/runs", null)).StatusCode);
        var bobsChecklists = await bob.GetFromJsonAsync<List<IdResponse>>("/api/checklists");
        Assert.DoesNotContain(bobsChecklists!, item => item.Id == checklist.Id);
        Assert.Equal(HttpStatusCode.OK, (await alice.GetAsync($"/api/checklists/{checklist.Id}")).StatusCode);
    }

    private WebApplicationFactory<Program> CreateFactory(bool allowTestSignIn = true, string serviceToken = "")
    {
        // Development uses the in-memory database, so the app starts without SQL Server.
        return factory.WithWebHostBuilder(builder => builder
            .UseEnvironment("Development")
            .UseSetting("Authentication:AllowTestSignIn", allowTestSignIn.ToString())
            .UseSetting("Authentication:ServiceToken", serviceToken));
    }

    private HttpClient CreateClient(string? token = null)
    {
        return CreateClient(CreateFactory(), token);
    }

    private static HttpClient CreateClient(WebApplicationFactory<Program> webFactory, string? token)
    {
        var client = webFactory.CreateClient();

        if (token is not null)
        {
            client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        }

        return client;
    }

    private sealed record MeResponse(string? DisplayName, string? Email);

    private sealed record IdResponse(int Id);

    private sealed record ChecklistResponse(int Id, string Name);

    private sealed record ChecklistDetailResponse(int Id, string Name, List<IdResponse> Steps);
}
