-- A row means StepId can't be done until DependsOnStepId is. Both are steps of the same checklist, which the API
-- checks, and the API also rejects cycles. Only StepId cascades: a second cascading key to ChecklistSteps would fail
-- with SQL Server's "multiple cascade paths" error. The app deletes the rows that name a step in DependsOnStepId
-- itself when it deletes that step. Deleting a checklist deletes all of its steps in one statement, so the cascade
-- through StepId removes every row before the DependsOnStepId key is checked.
CREATE TABLE [dbo].[StepDependencies] (
    [StepId] INT NOT NULL,
    [DependsOnStepId] INT NOT NULL,
    CONSTRAINT [PK_StepDependencies] PRIMARY KEY CLUSTERED ([StepId] ASC, [DependsOnStepId] ASC),
    CONSTRAINT [FK_StepDependencies_ChecklistSteps_StepId] FOREIGN KEY ([StepId])
        REFERENCES [dbo].[ChecklistSteps] ([Id]) ON DELETE CASCADE,
    CONSTRAINT [FK_StepDependencies_ChecklistSteps_DependsOnStepId] FOREIGN KEY ([DependsOnStepId])
        REFERENCES [dbo].[ChecklistSteps] ([Id]),
    CONSTRAINT [CK_StepDependencies_NotSelf] CHECK ([StepId] <> [DependsOnStepId])
);

CREATE NONCLUSTERED INDEX [IX_StepDependencies_DependsOnStepId]
    ON [dbo].[StepDependencies] ([DependsOnStepId] ASC);
