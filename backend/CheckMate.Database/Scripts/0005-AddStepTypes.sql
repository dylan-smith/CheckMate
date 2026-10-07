-- Existing steps and run steps become Checkbox. ChecklistRunSteps keeps its own copy of the type, like StepText,
-- so changing or deleting a step doesn't change how past runs show it. StepType holds the StepType enum's values
-- in CheckMate.Api: 0 = Checkbox, 1 = Text.
ALTER TABLE [dbo].[ChecklistSteps]
    ADD [StepType] INT NOT NULL
        CONSTRAINT [DF_ChecklistSteps_StepType] DEFAULT 0;

ALTER TABLE [dbo].[ChecklistRunSteps]
    ADD [StepType] INT NOT NULL
        CONSTRAINT [DF_ChecklistRunSteps_StepType] DEFAULT 0,
    [ResponseText] NVARCHAR(1000) NULL;
