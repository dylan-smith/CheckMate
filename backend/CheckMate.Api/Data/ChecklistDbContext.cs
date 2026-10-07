using CheckMate.Api.Models;
using Microsoft.EntityFrameworkCore;

namespace CheckMate.Api.Data;

public class ChecklistDbContext(DbContextOptions<ChecklistDbContext> options) : DbContext(options)
{
    public DbSet<Checklist> Checklists => Set<Checklist>();

    public DbSet<ChecklistStep> ChecklistSteps => Set<ChecklistStep>();

    public DbSet<ChecklistRun> ChecklistRuns => Set<ChecklistRun>();

    public DbSet<RunStepResponse> RunStepResponses => Set<RunStepResponse>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<Checklist>()
            .HasIndex(checklist => checklist.Name)
            .IsUnique();

        modelBuilder.Entity<Checklist>()
            .Property(checklist => checklist.Name)
            .HasMaxLength(200)
            .IsRequired();

        modelBuilder.Entity<ChecklistStep>()
            .HasOne<Checklist>()
            .WithMany()
            .HasForeignKey(step => step.ChecklistId)
            .OnDelete(DeleteBehavior.Cascade);

        modelBuilder.Entity<ChecklistStep>()
            .HasIndex(step => new { step.ChecklistId, step.SortOrder });

        modelBuilder.Entity<ChecklistStep>()
            .Property(step => step.Text)
            .HasMaxLength(500)
            .IsRequired();

        modelBuilder.Entity<ChecklistRun>()
            .HasOne<Checklist>()
            .WithMany()
            .HasForeignKey(run => run.ChecklistId)
            .OnDelete(DeleteBehavior.Cascade);

        modelBuilder.Entity<RunStepResponse>()
            .HasOne<ChecklistRun>()
            .WithMany(run => run.Responses)
            .HasForeignKey(response => response.RunId)
            .OnDelete(DeleteBehavior.Cascade);

        // No cascade in the database (see 0003-CreateChecklistRunsTables.sql), so the app clears StepId itself.
        modelBuilder.Entity<RunStepResponse>()
            .HasOne<ChecklistStep>()
            .WithMany()
            .HasForeignKey(response => response.StepId)
            .OnDelete(DeleteBehavior.ClientSetNull);

        modelBuilder.Entity<RunStepResponse>()
            .HasIndex(response => new { response.RunId, response.SortOrder });

        modelBuilder.Entity<RunStepResponse>()
            .Property(response => response.StepText)
            .HasMaxLength(500)
            .IsRequired();
    }
}
