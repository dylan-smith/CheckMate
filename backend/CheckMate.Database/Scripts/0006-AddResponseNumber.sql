-- The value entered for a number step (StepType 2 = Number): up to 9 digits before the decimal point and 6 after.
-- That's 15 significant digits, which a JavaScript number holds exactly, so the browser can't round a value.
ALTER TABLE [dbo].[ChecklistRunSteps]
    ADD [ResponseNumber] DECIMAL(15, 6) NULL;
