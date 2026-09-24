using System.Data.Common;
using Azure.Monitor.OpenTelemetry.AspNetCore;
using CheckMate.Api.Data;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;

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

    // Resuming a serverless database from auto-pause can take longer than the 30-second connection
    // timeout, which surfaces as client timeout error -2. EF Core doesn't treat -2 as transient, so
    // add it: the next attempt connects once the resume finishes.
    builder.Services.AddDbContext<ChecklistDbContext>(options =>
        options.UseSqlServer(connectionString, sqlOptions => sqlOptions.EnableRetryOnFailure(
            maxRetryCount: 8,
            maxRetryDelay: TimeSpan.FromSeconds(10),
            errorNumbersToAdd: [-2])));
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

    // Open the connection through the SQL Server execution strategy so that transient errors,
    // such as 40613 while a serverless Azure SQL database resumes from auto-pause, are retried.
    // Individual attempts can each run up to the connection timeout, so a hard deadline keeps the
    // whole check under the ASP.NET Core Module's default 120-second startup time limit.
    using var connectTimeout = new CancellationTokenSource(TimeSpan.FromSeconds(90));

    try
    {
        await dbContext.Database.CreateExecutionStrategy().ExecuteAsync(async cancellationToken =>
        {
            await dbContext.Database.OpenConnectionAsync(cancellationToken);
            await dbContext.Database.CloseConnectionAsync();
        }, connectTimeout.Token);

        Console.WriteLine("[Startup] Database connectivity confirmed.");
    }
    catch (Exception ex) when (ex is DbException or RetryLimitExceededException or OperationCanceledException)
    {
        // Don't fail startup: a crashed in-process app keeps serving HTTP 500.30 until it is
        // restarted, even after the database comes back. Start anyway and let each request retry
        // through EF Core's retry-on-failure; the deployment smoke tests catch lasting failures.
        Console.WriteLine(
            $"[Startup] WARNING: Could not confirm database connectivity; starting anyway. {ex.GetType().Name}: {ex.Message}");
    }
}

app.UseCors();
app.UseHttpsRedirection();
app.MapControllers();

Console.WriteLine("[Startup] Application startup complete. Listening for requests...");

app.Run();
