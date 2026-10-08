import { apiBaseUrl } from '../config'
import { apiFetch } from './client'
import { ApiError } from './checklists'
import type {
  StepOption,
  StepType,
  ValidationErrorResponse,
} from './checklists'

// stepId is null once the step has been deleted from the checklist. The text and type are what the step had
// when the run started, so they stay the same after the step is edited or deleted.
export type RunStep = {
  stepId: number | null
  text: string
  type: StepType
  isDone: boolean
  completedAt: string | null
  // The value entered for a text or number step.
  responseText: string | null
  responseNumber: number | null
  // A choice step's current options, which are empty once the step is deleted. selectedOptionText is the
  // picked option's text when it was picked, and selectedOptionId is null once that option is removed.
  options: StepOption[]
  selectedOptionId: number | null
  selectedOptionText: string | null
  // The steps of the run that must be done before this one, which are its current prerequisites like its
  // options are. It's locked, and can't be filled in, while one of them isn't done.
  dependsOnStepIds: number[]
  isLocked: boolean
}

// clientKey is the key this device, or another, gave the run when it started it (see src/offline/runs.ts).
export type ChecklistRun = {
  id: number
  clientKey: string
  checklistId: number
  checklistName: string
  startedAt: string
  completedAt: string | null
  steps: RunStep[]
}

// One past fill-out in the checklist page's history, without its steps.
export type ChecklistRunSummary = {
  id: number
  clientKey: string
  startedAt: string
  completedAt: string | null
}

// A step of a run as this device sends it: the step as it showed it, and the answer. The API keeps the text
// and type from the first sync, and decides from the answer whether the step is done, like RunStep shows it.
export type RunSyncStep = {
  stepId: number
  text: string
  type: StepType
  isDone: boolean
  completedAt: string | null
  responseText: string | null
  responseNumber: number | null
  selectedOptionId: number | null
  selectedOptionText: string | null
}

export type RunSyncBody = {
  startedAt: string
  completedAt: string | null
  steps: RunSyncStep[]
}

type ErrorResponse = {
  message?: string
}

const runsUrl = `${apiBaseUrl}/api/runs`

const completedMessage = "This run is complete and can't be changed."

// A 409 means the run was already completed, for example on another device.
async function throwIfCompleted(response: Response) {
  if (response.status === 409) {
    const error = (await response.json()) as ErrorResponse
    throw new ApiError(409, error.message ?? completedMessage)
  }
}

// A 400 explains why the run can't be saved as it is, such as a step whose prerequisites aren't done, so pass that on.
async function throwIfRejected(response: Response, fallback: string) {
  if (response.status === 400) {
    const error = (await response.json()) as ValidationErrorResponse
    const message = Object.values(error.errors ?? {}).flat()[0]
    throw new ApiError(400, message ?? fallback)
  }
}

// Newest first.
export async function getRuns(
  checklistId: number,
): Promise<ChecklistRunSummary[]> {
  const response = await apiFetch(
    `${apiBaseUrl}/api/checklists/${checklistId}/runs`,
  )
  if (!response.ok) {
    throw new Error('Unable to load fill-outs.')
  }
  return (await response.json()) as ChecklistRunSummary[]
}

// Returns null when there's no run with this id. Only links from before runs had keys use it.
export async function getRun(id: number): Promise<ChecklistRun | null> {
  const response = await apiFetch(`${runsUrl}/${id}`)
  if (response.status === 404) {
    return null
  }
  if (!response.ok) {
    throw new Error('Unable to load this fill-out.')
  }
  return (await response.json()) as ChecklistRun
}

// Returns null when no run has this key.
export async function getRunByKey(
  clientKey: string,
): Promise<ChecklistRun | null> {
  const response = await apiFetch(`${runsUrl}/${clientKey}`)
  if (response.status === 404) {
    return null
  }
  if (!response.ok) {
    throw new Error('Unable to load this fill-out.')
  }
  return (await response.json()) as ChecklistRun
}

// Sends the whole run as this device has it. The first sync creates the run and later ones update it, so
// sending the same run again after a lost reply changes nothing. A 404 means the checklist is gone.
export async function syncRun(
  checklistId: number,
  clientKey: string,
  body: RunSyncBody,
) {
  const response = await apiFetch(
    `${apiBaseUrl}/api/checklists/${checklistId}/runs/${clientKey}`,
    {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    },
  )

  await throwIfCompleted(response)
  await throwIfRejected(response, 'Unable to sync this fill-out.')
  if (response.status === 404) {
    throw new ApiError(404, 'This checklist has been deleted.')
  }
  if (!response.ok) {
    throw new Error('Unable to sync this fill-out.')
  }
  return (await response.json()) as ChecklistRun
}

// A 404 means the run is already gone, which is what the caller wanted.
export async function deleteRun(runId: number) {
  const response = await apiFetch(`${runsUrl}/${runId}`, { method: 'DELETE' })
  if (!response.ok && response.status !== 404) {
    throw new Error('Unable to delete this fill-out.')
  }
}
