CREATE TABLE [dbo].[ChecklistRuns] (
    [Id] INT IDENTITY(1,1) NOT NULL,
    [ChecklistId] INT NOT NULL,
    [StartedAt] DATETIMEOFFSET NOT NULL,
    [CompletedAt] DATETIMEOFFSET NULL,
    CONSTRAINT [PK_ChecklistRuns] PRIMARY KEY CLUSTERED ([Id] ASC),
    CONSTRAINT [FK_ChecklistRuns_Checklists_ChecklistId] FOREIGN KEY ([ChecklistId])
        REFERENCES [dbo].[Checklists] ([Id]) ON DELETE CASCADE
);

CREATE NONCLUSTERED INDEX [IX_ChecklistRuns_ChecklistId]
    ON [dbo].[ChecklistRuns] ([ChecklistId] ASC);

-- StepId has no cascade action: Checklists already cascades to these rows through ChecklistRuns, and a second
-- path through ChecklistSteps would fail with SQL Server's "multiple cascade paths" error. The app sets StepId
-- to NULL itself when it deletes a step, and StepText keeps the text the step had when the run started.
CREATE TABLE [dbo].[RunStepResponses] (
    [Id] INT IDENTITY(1,1) NOT NULL,
    [RunId] INT NOT NULL,
    [StepId] INT NULL,
    [StepText] NVARCHAR(500) NOT NULL,
    [SortOrder] INT NOT NULL,
    [IsDone] BIT NOT NULL,
    [CompletedAt] DATETIMEOFFSET NULL,
    CONSTRAINT [PK_RunStepResponses] PRIMARY KEY CLUSTERED ([Id] ASC),
    CONSTRAINT [FK_RunStepResponses_ChecklistRuns_RunId] FOREIGN KEY ([RunId])
        REFERENCES [dbo].[ChecklistRuns] ([Id]) ON DELETE CASCADE,
    CONSTRAINT [FK_RunStepResponses_ChecklistSteps_StepId] FOREIGN KEY ([StepId])
        REFERENCES [dbo].[ChecklistSteps] ([Id])
);

CREATE NONCLUSTERED INDEX [IX_RunStepResponses_RunId_SortOrder]
    ON [dbo].[RunStepResponses] ([RunId] ASC, [SortOrder] ASC);

CREATE NONCLUSTERED INDEX [IX_RunStepResponses_StepId]
    ON [dbo].[RunStepResponses] ([StepId] ASC);
