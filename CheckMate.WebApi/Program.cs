using CheckMate.WebApi.Data;
using Microsoft.EntityFrameworkCore;
using Azure.Identity;
using Microsoft.Data.SqlClient;

namespace CheckMate.WebApi;

public class Program
{
    public static void Main(string[] args)
    {
        var builder = WebApplication.CreateBuilder(args);

        // Add services to the container.
        builder.Services.AddDbContext<ApplicationDbContext>(options =>
        {
            var connectionString = builder.Configuration.GetConnectionString("DefaultConnection");

            // Only use Managed Identity when running in Azure App Service
            if (!string.IsNullOrEmpty(Environment.GetEnvironmentVariable("WEBSITE_INSTANCE_ID")))
            {
                var sqlConnection = new SqlConnection(connectionString);

                sqlConnection.AccessToken = new DefaultAzureCredential().GetToken(
                    new Azure.Core.TokenRequestContext(new[] { "https://database.windows.net/.default" })
                ).Token;

                options.UseSqlServer(sqlConnection);
            }
            else
            {
                // Use connection string authentication for local development
                options.UseSqlServer(connectionString);
            }
        });

        builder.Services.AddCors(options =>
        {
            options.AddPolicy("AllowNextJS", policy =>
            {
                policy.WithOrigins("http://localhost:3000")
                      .AllowAnyHeader()
                      .AllowAnyMethod();
            });
        });

        builder.Services.AddControllers();
        // Learn more about configuring OpenAPI at https://aka.ms/aspnet/openapi
        builder.Services.AddOpenApi();

        builder.Logging.AddFilter("Azure.Identity", LogLevel.Information);

        var app = builder.Build();

        // Configure the HTTP request pipeline.
        if (app.Environment.IsDevelopment())
        {
            app.MapOpenApi();
        }

        app.UseHttpsRedirection();

        app.UseCors("AllowNextJS");

        app.UseAuthorization();


        app.MapControllers();

        app.Run();
    }
}
