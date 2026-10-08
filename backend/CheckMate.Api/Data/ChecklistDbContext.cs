using CheckMate.Api.Authentication;
using CheckMate.Api.Models;
using Microsoft.EntityFrameworkCore;

namespace CheckMate.Api.Data;

/// <remarks>
/// Checklists and runs belong to a user. Query filters only show the current user's, and new ones are given the
/// current user when they're saved, so the controllers never handle the owner themselves. Everything else hangs off a
/// checklist or a run, so the controllers find that first.
/// </remarks>
public class ChecklistDbContext(DbContextOptions<ChecklistDbContext> options, CurrentUser currentUser) : DbContext(options)
{
    // Read by the query filters each time a query runs, so it's this request's user.
    private int? CurrentUserId => currentUser.UserId;

    public DbSet<User> Users => Set<User>();

    public DbSet<Checklist> Checklists => Set<Checklist>();

    public DbSet<ChecklistStep> ChecklistSteps => Set<ChecklistStep>();

    public DbSet<StepOption> StepOptions => Set<StepOption>();

    public DbSet<ChecklistRun> ChecklistRuns => Set<ChecklistRun>();

    public DbSet<ChecklistRunStep> ChecklistRunSteps => Set<ChecklistRunStep>();

    public DbSet<StepDependency> StepDependencies => Set<StepDependency>();

    public override int SaveChanges(bool acceptAllChangesOnSuccess)
    {
        AssignOwner();
        return base.SaveChanges(acceptAllChangesOnSuccess);
    }

    public override Task<int> SaveChangesAsync(bool acceptAllChangesOnSuccess, CancellationToken cancellationToken = default)
    {
        AssignOwner();
        return base.SaveChangesAsync(acceptAllChangesOnSuccess, cancellationToken);
    }

    private void AssignOwner()
    {
        foreach (var entry in ChangeTracker.Entries().Where(entry => entry.State == EntityState.Added))
        {
            switch (entry.Entity)
            {
                case Checklist checklist:
                    checklist.UserId = CurrentUserId ?? throw NoCurrentUser();
                    break;
                case ChecklistRun run:
                    run.UserId = CurrentUserId ?? throw NoCurrentUser();
                    break;
            }
        }

        static InvalidOperationException NoCurrentUser()
        {
            return new("Checklists and runs can only be saved for a signed-in user.");
        }
    }

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<User>()
            .HasIndex(user => user.Subject)
            .IsUnique();

        modelBuilder.Entity<User>()
            .Property(user => user.Subject)
            .HasMaxLength(255)
            .IsRequired();

        modelBuilder.Entity<User>()
            .Property(user => user.Email)
            .HasMaxLength(320);

        modelBuilder.Entity<User>()
            .Property(user => user.DisplayName)
            .HasMaxLength(200);

        modelBuilder.Entity<Checklist>()
            .HasQueryFilter(checklist => checklist.UserId == CurrentUserId);

        modelBuilder.Entity<Checklist>()
            .HasOne<User>()
            .WithMany()
            .HasForeignKey(checklist => checklist.UserId)
            .OnDelete(DeleteBehavior.Cascade);

        // Names only have to be unique among one user's checklists.
        modelBuilder.Entity<Checklist>()
            .HasIndex(checklist => new { checklist.UserId, checklist.Name })
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

        modelBuilder.Entity<StepOption>()
            .HasOne<ChecklistStep>()
            .WithMany(step => step.Options)
            .HasForeignKey(option => option.StepId)
            .OnDelete(DeleteBehavior.Cascade);

        modelBuilder.Entity<StepOption>()
            .HasIndex(option => new { option.StepId, option.SortOrder });

        modelBuilder.Entity<StepOption>()
            .Property(option => option.Text)
            .HasMaxLength(200)
            .IsRequired();

        modelBuilder.Entity<StepDependency>()
            .HasKey(dependency => new { dependency.StepId, dependency.DependsOnStepId });

        modelBuilder.Entity<StepDependency>()
            .HasOne<ChecklistStep>()
            .WithMany(step => step.DependsOn)
            .HasForeignKey(dependency => dependency.StepId)
            .OnDelete(DeleteBehavior.Cascade);

        // No cascade in the database (see 0008-CreateStepDependenciesTable.sql), so the app deletes these rows itself.
        modelBuilder.Entity<StepDependency>()
            .HasOne<ChecklistStep>()
            .WithMany()
            .HasForeignKey(dependency => dependency.DependsOnStepId)
            .OnDelete(DeleteBehavior.ClientCascade);

        modelBuilder.Entity<StepDependency>()
            .HasIndex(dependency => dependency.DependsOnStepId);

        modelBuilder.Entity<ChecklistRun>()
            .HasQueryFilter(run => run.UserId == CurrentUserId);

        modelBuilder.Entity<ChecklistRun>()
            .HasOne<Checklist>()
            .WithMany()
            .HasForeignKey(run => run.ChecklistId)
            .OnDelete(DeleteBehavior.Cascade);

        // No cascade in the database (see 0009-AddUsers.sql): runs are deleted with their checklist instead.
        modelBuilder.Entity<ChecklistRun>()
            .HasOne<User>()
            .WithMany()
            .HasForeignKey(run => run.UserId)
            .OnDelete(DeleteBehavior.ClientCascade);

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

        modelBuilder.Entity<ChecklistRunStep>()
            .Property(step => step.ResponseNumber)
            .HasPrecision(15, 6);

        // No cascade in the database either (see 0007-AddStepOptions.sql), so the app clears SelectedOptionId itself.
        modelBuilder.Entity<ChecklistRunStep>()
            .HasOne<StepOption>()
            .WithMany()
            .HasForeignKey(step => step.SelectedOptionId)
            .OnDelete(DeleteBehavior.ClientSetNull);

        modelBuilder.Entity<ChecklistRunStep>()
            .Property(step => step.SelectedOptionText)
            .HasMaxLength(200);
    }
}
