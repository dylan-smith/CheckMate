CREATE TABLE [dbo].[ChecklistSteps] (
    [Id] INT IDENTITY(1,1) NOT NULL,
    [ChecklistId] INT NOT NULL,
    [Text] NVARCHAR(500) NOT NULL,
    [SortOrder] INT NOT NULL,
    CONSTRAINT [PK_ChecklistSteps] PRIMARY KEY CLUSTERED ([Id] ASC),
    CONSTRAINT [FK_ChecklistSteps_Checklists_ChecklistId] FOREIGN KEY ([ChecklistId])
        REFERENCES [dbo].[Checklists] ([Id]) ON DELETE CASCADE
);

CREATE NONCLUSTERED INDEX [IX_ChecklistSteps_ChecklistId_SortOrder]
    ON [dbo].[ChecklistSteps] ([ChecklistId] ASC, [SortOrder] ASC);
