import type { ChecklistDetail } from '../api/checklists'
import type { ChecklistRun, RunSyncBody } from '../api/runs'
import type { LocalRun, LocalRunStep } from './store'

// How a fill-out changes on the device, before it reaches the API. These mirror the API's own rules for a step
// (see ChecklistRunsController.ApplyResponse), so what the device keeps is what the API will keep.

// A checkbox step sends isDone. A text step sends its text, and is done when the text isn't empty. A number step
// sends its number, and is done when it isn't null. A choice step sends the picked option's id, and is done when
// it isn't null.
export type RunStepUpdate =
  | { isDone: boolean }
  | { text: string }
  | { number: number | null }
  | { optionId: number | null }

export const lockedStepMessage =
  "This step can't be filled in until the steps it depends on are done."

export const unfinishedStepsMessage =
  'Every step must be done before the run can be completed.'

const optionNotOnStepMessage = "The option must be one of this step's options."

const numberLimitsMessage =
  'The number must have at most 9 digits before the decimal point and 6 after it.'

// A new fill-out of the checklist as this device has it, with a copy of each step as the API would make one.
export function createLocalRun(
  checklist: ChecklistDetail,
  clientKey: string,
  now: string,
): LocalRun {
  const steps = [...checklist.steps].sort(
    (a, b) => a.sortOrder - b.sortOrder || a.id - b.id,
  )
  return {
    clientKey,
    serverId: null,
    checklistId: checklist.id,
    checklistName: checklist.name,
    startedAt: now,
    completedAt: null,
    steps: steps.map((step, index) => ({
      stepId: step.id,
      text: step.text,
      type: step.type,
      sortOrder: index,
      options: step.options,
      dependsOnStepIds: step.dependsOnStepIds,
      isDone: false,
      completedAt: null,
      responseText: null,
      responseNumber: null,
      selectedOptionId: null,
      selectedOptionText: null,
    })),
    revision: 1,
    syncedRevision: 0,
    updatedAt: now,
    syncedAt: null,
    syncError: null,
    deletedAt: null,
  }
}

// A fill-out the API has, as this device keeps it from now on. Nothing is dirty yet.
export function fromServerRun(run: ChecklistRun, now: string): LocalRun {
  return {
    clientKey: run.clientKey,
    serverId: run.id,
    checklistId: run.checklistId,
    checklistName: run.checklistName,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    steps: run.steps.map((step, index) => ({
      stepId: step.stepId,
      text: step.text,
      type: step.type,
      sortOrder: index,
      options: step.options,
      dependsOnStepIds: step.dependsOnStepIds,
      isDone: step.isDone,
      completedAt: step.completedAt,
      responseText: step.responseText,
      responseNumber: step.responseNumber,
      selectedOptionId: step.selectedOptionId,
      selectedOptionText: step.selectedOptionText,
    })),
    revision: 0,
    syncedRevision: 0,
    updatedAt: now,
    syncedAt: now,
    syncError: null,
    deletedAt: null,
  }
}

// What the API gets. A step deleted from the checklist can't be sent, since the API finds steps by their id.
export function toSyncBody(run: LocalRun): RunSyncBody {
  return {
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    steps: [...run.steps]
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .flatMap((step) =>
        step.stepId === null
          ? []
          : [
              {
                stepId: step.stepId,
                text: step.text,
                type: step.type,
                isDone: step.isDone,
                completedAt: step.completedAt,
                responseText: step.responseText,
                responseNumber: step.responseNumber,
                selectedOptionId: step.selectedOptionId,
                selectedOptionText: step.selectedOptionText,
              },
            ],
      ),
  }
}

// A change to the fill-out, counted so the sync engine knows the API hasn't got it. A rejection from the API is
// about the fill-out as it was, so the change clears it and the fill-out is sent again.
export function bump(run: LocalRun, now: string): LocalRun {
  return {
    ...run,
    revision: run.revision + 1,
    updatedAt: now,
    syncError: run.syncError?.kind === 'rejected' ? null : run.syncError,
  }
}

// The step with the answer applied, done at now if the answer makes it done.
export function applyStepUpdate(
  step: LocalRunStep,
  update: RunStepUpdate,
  now: string,
): LocalRunStep {
  const next = { ...step }
  let isDone: boolean

  if ('text' in update) {
    const trimmed = update.text.trim()
    next.responseText = trimmed === '' ? null : trimmed
    isDone = next.responseText !== null
  } else if ('number' in update) {
    next.responseNumber = update.number
    isDone = update.number !== null
  } else if ('optionId' in update) {
    const option = step.options.find((item) => item.id === update.optionId)
    next.selectedOptionId = option?.id ?? null
    next.selectedOptionText = option?.text ?? null
    isDone = option !== undefined
  } else {
    isDone = update.isDone
  }

  if (isDone !== step.isDone) {
    next.isDone = isDone
    next.completedAt = isDone ? now : null
  }
  return next
}

const maxWholeDigits = 9

const maxFractionDigits = 6

function fitsNumber(number: number) {
  const [whole = '', fraction = ''] = Math.abs(number).toString().split('.')
  return (
    !whole.includes('e') &&
    whole.replace(/^0+/, '').length <= maxWholeDigits &&
    fraction.length <= maxFractionDigits
  )
}

// Why the API would refuse the change, or null when it wouldn't. The page already keeps the user from these,
// so this is the last check before the change is kept.
export function stepChangeError(
  run: LocalRun,
  stepId: number,
  update: RunStepUpdate,
): string | null {
  const step = run.steps.find((item) => item.stepId === stepId)
  if (step === undefined) {
    return null
  }
  const doneStepIds = new Set(
    run.steps.filter((item) => item.isDone).map((item) => item.stepId),
  )
  if (step.dependsOnStepIds.some((id) => !doneStepIds.has(id))) {
    return lockedStepMessage
  }
  if (
    'number' in update &&
    update.number !== null &&
    !fitsNumber(update.number)
  ) {
    return numberLimitsMessage
  }
  if (
    'optionId' in update &&
    update.optionId !== null &&
    !step.options.some((option) => option.id === update.optionId)
  ) {
    return optionNotOnStepMessage
  }
  const next = applyStepUpdate(step, update, '')
  if (step.isDone && !next.isDone) {
    const dependents = run.steps.filter(
      (item) => item.isDone && item.dependsOnStepIds.includes(stepId),
    )
    if (dependents.length > 0) {
      const names = dependents.map((item) => `"${item.text}"`).join(', ')
      return `Un-do ${names} first, since ${dependents.length === 1 ? 'it depends' : 'they depend'} on this step.`
    }
  }
  return null
}

// The steps that keep the fill-out from being completed. As in the API, a step deleted from the checklist
// can't be filled in any more, so it doesn't hold the fill-out back.
export function unfinishedSteps(run: LocalRun) {
  return run.steps.filter((step) => !step.isDone && step.stepId !== null)
}
