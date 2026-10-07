-- Existing steps and responses become Checkbox. RunStepResponses keeps its own copy of the type, like StepText,
-- so changing or deleting a step doesn't change how past runs show it.
ALTER TABLE [dbo].[ChecklistSteps]
    ADD [StepType] NVARCHAR(20) NOT NULL
        CONSTRAINT [DF_ChecklistSteps_StepType] DEFAULT N'Checkbox';

ALTER TABLE [dbo].[RunStepResponses]
    ADD [StepType] NVARCHAR(20) NOT NULL
        CONSTRAINT [DF_RunStepResponses_StepType] DEFAULT N'Checkbox',
    [ResponseText] NVARCHAR(1000) NULL;
