using Azure.Monitor.OpenTelemetry.AspNetCore;
using CheckMate.Api.Data;
using Microsoft.EntityFrameworkCore;

var builder = WebApplication.CreateBuilder(args);

Console.WriteLine("[Startup] Application starting...");
Console.WriteLine($"[Startup] Environment: {builder.Environment.EnvironmentName}");

var useInMemoryDatabase = builder.Configuration.GetValue<bool>("UseInMemoryDatabase");

var aiConnectionStringFromConfig = builder.Configuration["AzureMonitor:ConnectionString"]
    is string cs && !string.IsNullOrWhiteSpace(cs)
    ? cs
    : null;
var aiConnectionStringFromEnv = builder.Configuration["APPLICATIONINSIGHTS_CONNECTION_STRING"]
    is string envCs && !string.IsNullOrWhiteSpace(envCs)
    ? envCs
    : null;
var azureMonitorConnectionString = aiConnectionStringFromConfig ?? aiConnectionStringFromEnv;

if (aiConnectionStringFromConfig != null)
{
    Console.WriteLine("[Startup] Application Insights connection string found in AzureMonitor:ConnectionString config setting.");
}
else if (aiConnectionStringFromEnv != null)
{
    Console.WriteLine("[Startup] Application Insights connection string found in APPLICATIONINSIGHTS_CONNECTION_STRING environment variable.");
}
else
{
    Console.WriteLine("[Startup] No Application Insights connection string found. Telemetry will be disabled.");
}

if (!string.IsNullOrWhiteSpace(azureMonitorConnectionString))
{
    Console.WriteLine("[Startup] Configuring Azure Monitor / Application Insights...");
    builder.Services.AddOpenTelemetry().UseAzureMonitor(options =>
        options.ConnectionString = azureMonitorConnectionString);
    Console.WriteLine("[Startup] Azure Monitor / Application Insights configured successfully.");
}

builder.Services.AddControllers();
builder.Services.AddOpenApi();
var allowedOrigins = builder.Configuration
    .GetSection("Cors:AllowedOrigins")
    .Get<string[]>() ?? [];

Console.WriteLine(
    allowedOrigins.Length == 0
        ? "[Startup] CORS: No allowed origins configured."
        : $"[Startup] CORS allowed origins: {string.Join(", ", allowedOrigins)}");

builder.Services.AddCors(options => options.AddDefaultPolicy(policy =>
    {
        if (allowedOrigins.Length == 0)
        {
            return;
        }

        policy.WithOrigins(allowedOrigins)
            .AllowAnyHeader()
            .AllowAnyMethod();
    }));

if (useInMemoryDatabase)
{
    Console.WriteLine("[Startup] Database mode: in-memory.");
    builder.Services.AddDbContext<ChecklistDbContext>(options =>
        options.UseInMemoryDatabase("CheckMate"));
}
else
{
    Console.WriteLine("[Startup] Database mode: SQL Server.");
    var connectionString = builder.Configuration.GetConnectionString("CheckMate")
        ?? throw new InvalidOperationException("Connection string 'CheckMate' not found.");

    builder.Services.AddDbContext<ChecklistDbContext>(options =>
        options.UseSqlServer(connectionString, sqlOptions => sqlOptions.EnableRetryOnFailure()));
}

var app = builder.Build();

if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
}

using var scope = app.Services.CreateScope();
var dbContext = scope.ServiceProvider.GetRequiredService<ChecklistDbContext>();

if (useInMemoryDatabase)
{
    dbContext.Database.EnsureCreated();
    Console.WriteLine("[Startup] In-memory database created.");
}
else
{
    Console.WriteLine("[Startup] Testing database connectivity...");

    // A serverless Azure SQL database can take up to a minute to resume from auto-pause,
    // so keep retrying for a while before treating the database as unreachable. The deadline
    // stays under the ASP.NET Core Module's default 120-second startup time limit.
    var connectDeadline = DateTime.UtcNow.AddSeconds(75);
    var attempt = 1;

    while (!dbContext.Database.CanConnect())
    {
        if (DateTime.UtcNow >= connectDeadline)
        {
            throw new InvalidOperationException(
                "Cannot connect to the database. Ensure the database has been created and migrations have been applied.");
        }

        Console.WriteLine(
            $"[Startup] Database not reachable (attempt {attempt}); it may be resuming from auto-pause. Retrying in 5 seconds...");
        attempt++;
        Thread.Sleep(TimeSpan.FromSeconds(5));
    }

    Console.WriteLine("[Startup] Database connectivity confirmed.");
}

app.UseCors();
app.UseHttpsRedirection();
app.MapControllers();

Console.WriteLine("[Startup] Application startup complete. Listening for requests...");

app.Run();
