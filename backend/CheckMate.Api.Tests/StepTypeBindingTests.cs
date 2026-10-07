using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;

namespace CheckMate.Api.Tests;

public class StepTypeBindingTests(WebApplicationFactory<Program> factory)
    : IClassFixture<WebApplicationFactory<Program>>
{
    [Theory]
    [InlineData("\"Text\"", HttpStatusCode.Created)]
    [InlineData("\"Checkbox\"", HttpStatusCode.Created)]
    [InlineData("0", HttpStatusCode.BadRequest)]
    [InlineData("1", HttpStatusCode.BadRequest)]
    [InlineData("7", HttpStatusCode.BadRequest)]
    [InlineData("\"Bogus\"", HttpStatusCode.BadRequest)]
    public async Task CreateStep_AcceptsTypeByNameOnly(string type, HttpStatusCode expected)
    {
        // Development uses the in-memory database, so the app starts without SQL Server.
        using var client = factory.WithWebHostBuilder(builder => builder.UseEnvironment("Development"))
            .CreateClient();
        var checklistResponse = await client.PostAsJsonAsync("/api/checklists", new { name = Guid.NewGuid().ToString() });
        checklistResponse.EnsureSuccessStatusCode();
        var checklist = await checklistResponse.Content.ReadFromJsonAsync<IdResponse>();

        using var content = new StringContent($$"""{"text":"Step","type":{{type}}}""", System.Text.Encoding.UTF8, "application/json");
        var response = await client.PostAsync($"/api/checklists/{checklist!.Id}/steps", content);

        Assert.Equal(expected, response.StatusCode);
    }

    private sealed record IdResponse(int Id);
}
