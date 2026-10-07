-- Existing steps and run steps become Checkbox. ChecklistRunSteps keeps its own copy of the type, like StepText,
-- so changing or deleting a step doesn't change how past runs show it.
ALTER TABLE [dbo].[ChecklistSteps]
    ADD [StepType] NVARCHAR(20) NOT NULL
        CONSTRAINT [DF_ChecklistSteps_StepType] DEFAULT N'Checkbox';

ALTER TABLE [dbo].[ChecklistRunSteps]
    ADD [StepType] NVARCHAR(20) NOT NULL
        CONSTRAINT [DF_ChecklistRunSteps_StepType] DEFAULT N'Checkbox',
    [ResponseText] NVARCHAR(1000) NULL;
