using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;

namespace CheckMate.Api.Tests;

public class HealthCheckTests(WebApplicationFactory<Program> factory)
    : IClassFixture<WebApplicationFactory<Program>>
{
    [Fact]
    public async Task Health_ReturnsHealthy()
    {
        // Development uses the in-memory database, so the app starts without SQL Server.
        using var client = factory.WithWebHostBuilder(builder => builder.UseEnvironment("Development"))
            .CreateClient();

        var response = await client.GetAsync("/health");

        response.EnsureSuccessStatusCode();
        Assert.Equal("Healthy", await response.Content.ReadAsStringAsync());
    }
}
