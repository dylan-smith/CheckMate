using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;

namespace CheckMate.Api.Tests;

// How a synced run looks over HTTP: the error keys a device places next to its steps, and the times it sent.
public class RunSyncBindingTests(WebApplicationFactory<Program> factory)
    : IClassFixture<WebApplicationFactory<Program>>
{
    [Fact]
    public async Task Sync_ReportsProblemsUnderTheStepTheyAreIn()
    {
        using var client = CreateClient();
        var (checklistId, stepId) = await CreateChecklistWithStepAsync(client, "Number");

        var response = await client.PutAsJsonAsync($"/api/checklists/{checklistId}/runs/{Guid.NewGuid()}", new
        {
            startedAt = "2026-10-01T08:00:00Z",
            steps = new[] { new { stepId, text = "Depth", type = "Number", responseNumber = 1.1234567 } }
        });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        using var problem = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        var errors = problem.RootElement.GetProperty("errors");
        Assert.True(errors.TryGetProperty("Steps[0].ResponseNumber", out var messages));
        Assert.Contains("9 digits", messages[0].GetString());
    }

    [Fact]
    public async Task Sync_RejectsAKeyThatIsNotAGuid_WithNotFound()
    {
        using var client = CreateClient();
        var (checklistId, _) = await CreateChecklistWithStepAsync(client, "Checkbox");

        var response = await client.PutAsJsonAsync($"/api/checklists/{checklistId}/runs/not-a-key", new { startedAt = "2026-10-01T08:00:00Z", steps = Array.Empty<object>() });

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task Sync_RoundTripsTheDevicesTimesAndKey()
    {
        using var client = CreateClient();
        var (checklistId, stepId) = await CreateChecklistWithStepAsync(client, "Checkbox");
        var key = Guid.NewGuid();

        var response = await client.PutAsJsonAsync($"/api/checklists/{checklistId}/runs/{key}", new
        {
            startedAt = "2026-10-01T08:00:00+02:00",
            completedAt = "2026-10-01T08:10:00+02:00",
            steps = new[] { new { stepId, text = "Tick", type = "Checkbox", isDone = true, completedAt = "2026-10-01T08:05:00+02:00" } }
        });

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var synced = await client.GetFromJsonAsync<RunResponse>($"/api/runs/{key}");
        Assert.NotNull(synced);
        Assert.Equal(key, synced.ClientKey);
        Assert.Equal(new DateTimeOffset(2026, 10, 1, 6, 0, 0, TimeSpan.Zero), synced.StartedAt);
        Assert.Equal(new DateTimeOffset(2026, 10, 1, 6, 10, 0, TimeSpan.Zero), synced.CompletedAt);
        Assert.Equal(new DateTimeOffset(2026, 10, 1, 6, 5, 0, TimeSpan.Zero), Assert.Single(synced.Steps).CompletedAt);
    }

    private HttpClient CreateClient()
    {
        // Development uses the in-memory database, so the app starts without SQL Server.
        var client = factory.WithWebHostBuilder(builder => builder.UseEnvironment("Development")).CreateClient();
        client.DefaultRequestHeaders.Authorization = new("Bearer", "test:Sync Binding Tests");
        return client;
    }

    private static async Task<(int ChecklistId, int StepId)> CreateChecklistWithStepAsync(HttpClient client, string type)
    {
        var checklistResponse = await client.PostAsJsonAsync("/api/checklists", new { name = Guid.NewGuid().ToString() });
        checklistResponse.EnsureSuccessStatusCode();
        var checklist = await checklistResponse.Content.ReadFromJsonAsync<IdResponse>();
        var stepResponse = await client.PostAsJsonAsync($"/api/checklists/{checklist!.Id}/steps", new { text = "Step", type });
        stepResponse.EnsureSuccessStatusCode();
        var step = await stepResponse.Content.ReadFromJsonAsync<IdResponse>();
        return (checklist.Id, step!.Id);
    }

    private sealed record IdResponse(int Id);

    private sealed record RunResponse(Guid ClientKey, DateTimeOffset StartedAt, DateTimeOffset? CompletedAt, IReadOnlyList<RunStepResponse> Steps);

    private sealed record RunStepResponse(DateTimeOffset? CompletedAt);
}
