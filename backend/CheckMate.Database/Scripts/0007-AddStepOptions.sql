-- The options of a choice step (StepType 3 = Choice), in the order they're listed. They're deleted with their step.
CREATE TABLE [dbo].[StepOptions] (
    [Id] INT IDENTITY(1,1) NOT NULL,
    [StepId] INT NOT NULL,
    [Text] NVARCHAR(200) NOT NULL,
    [SortOrder] INT NOT NULL,
    CONSTRAINT [PK_StepOptions] PRIMARY KEY CLUSTERED ([Id] ASC),
    CONSTRAINT [FK_StepOptions_ChecklistSteps_StepId] FOREIGN KEY ([StepId])
        REFERENCES [dbo].[ChecklistSteps] ([Id]) ON DELETE CASCADE
);

CREATE NONCLUSTERED INDEX [IX_StepOptions_StepId_SortOrder]
    ON [dbo].[StepOptions] ([StepId] ASC, [SortOrder] ASC);

-- The option picked for a choice step. SelectedOptionText keeps the option's text from when it was picked, so editing
-- or removing the option later doesn't change the run. Like StepId, SelectedOptionId has no cascade action (that would
-- be a second cascade path from Checklists), so the app sets it to NULL itself when it removes an option.
ALTER TABLE [dbo].[ChecklistRunSteps]
    ADD [SelectedOptionId] INT NULL,
    [SelectedOptionText] NVARCHAR(200) NULL,
    CONSTRAINT [FK_ChecklistRunSteps_StepOptions_SelectedOptionId] FOREIGN KEY ([SelectedOptionId])
        REFERENCES [dbo].[StepOptions] ([Id]);
GO

CREATE NONCLUSTERED INDEX [IX_ChecklistRunSteps_SelectedOptionId]
    ON [dbo].[ChecklistRunSteps] ([SelectedOptionId] ASC);
