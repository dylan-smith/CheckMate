using CheckMate.Api.Models;
using Microsoft.EntityFrameworkCore;

namespace CheckMate.Api.Data;

public class ChecklistDbContext(DbContextOptions<ChecklistDbContext> options) : DbContext(options)
{
    public DbSet<Checklist> Checklists => Set<Checklist>();

    public DbSet<ChecklistStep> ChecklistSteps => Set<ChecklistStep>();

    public DbSet<ChecklistRun> ChecklistRuns => Set<ChecklistRun>();

    public DbSet<ChecklistRunStep> ChecklistRunSteps => Set<ChecklistRunStep>();

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

        modelBuilder.Entity<ChecklistStep>()
            .Property(step => step.Type)
            .HasColumnName("StepType");

        modelBuilder.Entity<ChecklistRun>()
            .HasOne<Checklist>()
            .WithMany()
            .HasForeignKey(run => run.ChecklistId)
            .OnDelete(DeleteBehavior.Cascade);

        // Saves that must only happen while the run is open include the run with this as the original value, so the
        // UPDATE only matches while CompletedAt is still null and a run completed in the meantime fails the save.
        modelBuilder.Entity<ChecklistRun>()
            .Property(run => run.CompletedAt)
            .IsConcurrencyToken();

        modelBuilder.Entity<ChecklistRunStep>()
            .HasOne<ChecklistRun>()
            .WithMany(run => run.Steps)
            .HasForeignKey(step => step.RunId)
            .OnDelete(DeleteBehavior.Cascade);

        // No cascade in the database (see 0003-CreateChecklistRunsTables.sql), so the app clears StepId itself.
        modelBuilder.Entity<ChecklistRunStep>()
            .HasOne<ChecklistStep>()
            .WithMany()
            .HasForeignKey(step => step.StepId)
            .OnDelete(DeleteBehavior.ClientSetNull);

        modelBuilder.Entity<ChecklistRunStep>()
            .HasIndex(step => new { step.RunId, step.SortOrder });

        modelBuilder.Entity<ChecklistRunStep>()
            .Property(step => step.StepText)
            .HasMaxLength(500)
            .IsRequired();

        modelBuilder.Entity<ChecklistRunStep>()
            .Property(step => step.ResponseText)
            .HasMaxLength(1000);
    }
}
