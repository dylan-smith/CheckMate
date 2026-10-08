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
        client.DefaultRequestHeaders.Authorization = new("Bearer", "test:Binding Tests");
        var checklistResponse = await client.PostAsJsonAsync("/api/checklists", new { name = Guid.NewGuid().ToString() });
        checklistResponse.EnsureSuccessStatusCode();
        var checklist = await checklistResponse.Content.ReadFromJsonAsync<IdResponse>();

        using var content = new StringContent($$"""{"text":"Step","type":{{type}}}""", System.Text.Encoding.UTF8, "application/json");
        var response = await client.PostAsync($"/api/checklists/{checklist!.Id}/steps", content);

        Assert.Equal(expected, response.StatusCode);
    }

    [Fact]
    public async Task CreateStep_ReadsChoiceOptions()
    {
        using var client = factory.WithWebHostBuilder(builder => builder.UseEnvironment("Development"))
            .CreateClient();
        client.DefaultRequestHeaders.Authorization = new("Bearer", "test:Binding Tests");
        var checklistResponse = await client.PostAsJsonAsync("/api/checklists", new { name = Guid.NewGuid().ToString() });
        checklistResponse.EnsureSuccessStatusCode();
        var checklist = await checklistResponse.Content.ReadFromJsonAsync<IdResponse>();

        var response = await client.PostAsJsonAsync($"/api/checklists/{checklist!.Id}/steps", new
        {
            text = "Weather",
            type = "Choice",
            options = new[] { new { text = "Sunny" }, new { text = "Rainy" } }
        });

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var step = await response.Content.ReadFromJsonAsync<StepResponse>();
        Assert.Equal(["Sunny", "Rainy"], step!.Options.Select(option => option.Text));
    }

    private sealed record StepResponse(int Id, IReadOnlyList<OptionResponse> Options);

    private sealed record OptionResponse(int Id, string Text);

    private sealed record IdResponse(int Id);
}
