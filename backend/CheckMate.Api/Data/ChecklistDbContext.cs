using CheckMate.Api.Models;
using Microsoft.EntityFrameworkCore;

namespace CheckMate.Api.Data;

public class ChecklistDbContext(DbContextOptions<ChecklistDbContext> options) : DbContext(options)
{
    public DbSet<Checklist> Checklists => Set<Checklist>();

    public DbSet<ChecklistStep> ChecklistSteps => Set<ChecklistStep>();

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
    }
}
