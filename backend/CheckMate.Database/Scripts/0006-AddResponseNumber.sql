-- The value entered for a number step (StepType 2 = Number): up to 12 digits before the decimal point and 6 after.
ALTER TABLE [dbo].[ChecklistRunSteps]
    ADD [ResponseNumber] DECIMAL(18, 6) NULL;
