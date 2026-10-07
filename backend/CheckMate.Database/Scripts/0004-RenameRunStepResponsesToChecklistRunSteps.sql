-- Rename RunStepResponses to ChecklistRunSteps to match ChecklistSteps and ChecklistRuns, along with its keys and indexes.
EXEC sp_rename N'dbo.RunStepResponses', N'ChecklistRunSteps';

EXEC sp_rename N'dbo.PK_RunStepResponses', N'PK_ChecklistRunSteps', N'OBJECT';
EXEC sp_rename N'dbo.FK_RunStepResponses_ChecklistRuns_RunId', N'FK_ChecklistRunSteps_ChecklistRuns_RunId', N'OBJECT';
EXEC sp_rename N'dbo.FK_RunStepResponses_ChecklistSteps_StepId', N'FK_ChecklistRunSteps_ChecklistSteps_StepId', N'OBJECT';

EXEC sp_rename N'dbo.ChecklistRunSteps.IX_RunStepResponses_RunId_SortOrder', N'IX_ChecklistRunSteps_RunId_SortOrder', N'INDEX';
EXEC sp_rename N'dbo.ChecklistRunSteps.IX_RunStepResponses_StepId', N'IX_ChecklistRunSteps_StepId', N'INDEX';
