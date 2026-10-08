-- Checklists and runs now belong to the user who created them. Data saved before sign-in existed has no owner, so
-- it's deleted rather than assigned to someone. Children go first because some keys don't cascade.
DELETE FROM [dbo].[ChecklistRunSteps];
DELETE FROM [dbo].[ChecklistRuns];
DELETE FROM [dbo].[StepDependencies];
DELETE FROM [dbo].[StepOptions];
DELETE FROM [dbo].[ChecklistSteps];
DELETE FROM [dbo].[Checklists];

-- Subject is the signed-in identity, prefixed with where it came from (e.g. "google:<sub>").
CREATE TABLE [dbo].[Users] (
    [Id] INT IDENTITY(1,1) NOT NULL,
    [Subject] NVARCHAR(255) NOT NULL,
    [Email] NVARCHAR(320) NULL,
    [DisplayName] NVARCHAR(200) NULL,
    [CreatedAt] DATETIMEOFFSET NOT NULL,
    CONSTRAINT [PK_Users] PRIMARY KEY CLUSTERED ([Id] ASC)
);

CREATE UNIQUE NONCLUSTERED INDEX [IX_Users_Subject]
    ON [dbo].[Users] ([Subject] ASC);

ALTER TABLE [dbo].[Checklists]
    ADD [UserId] INT NOT NULL
    CONSTRAINT [FK_Checklists_Users_UserId] FOREIGN KEY ([UserId])
        REFERENCES [dbo].[Users] ([Id]) ON DELETE CASCADE;

-- Names only have to be unique among one user's checklists.
DROP INDEX [IX_Checklists_Name] ON [dbo].[Checklists];

CREATE UNIQUE NONCLUSTERED INDEX [IX_Checklists_UserId_Name]
    ON [dbo].[Checklists] ([UserId] ASC, [Name] ASC);

-- UserId has no cascade action: Users already cascades to runs through Checklists, and a second path would fail
-- with SQL Server's "multiple cascade paths" error. A run always has the same user as its checklist.
ALTER TABLE [dbo].[ChecklistRuns]
    ADD [UserId] INT NOT NULL
    CONSTRAINT [FK_ChecklistRuns_Users_UserId] FOREIGN KEY ([UserId])
        REFERENCES [dbo].[Users] ([Id]);

CREATE NONCLUSTERED INDEX [IX_ChecklistRuns_UserId]
    ON [dbo].[ChecklistRuns] ([UserId] ASC);
