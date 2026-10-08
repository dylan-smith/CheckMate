-- A device gives a run its key before the run reaches the server, so a sync sent again after a lost reply finds the
-- run it made the first time instead of making a second one. Keys only have to be unique among one user's runs,
-- which is all a sync looks through. Runs saved before this get a key of their own, so the column can be required;
-- the API sets the key itself from here on, and the default only filled the existing rows.
ALTER TABLE [dbo].[ChecklistRuns]
    ADD [ClientKey] UNIQUEIDENTIFIER NOT NULL
        CONSTRAINT [DF_ChecklistRuns_ClientKey] DEFAULT NEWID();
GO

CREATE UNIQUE NONCLUSTERED INDEX [IX_ChecklistRuns_UserId_ClientKey]
    ON [dbo].[ChecklistRuns] ([UserId] ASC, [ClientKey] ASC);
