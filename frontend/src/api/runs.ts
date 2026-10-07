import { apiBaseUrl } from '../config'
import { ApiError } from './checklists'
import type { StepType } from './checklists'

// stepId is null once the step has been deleted from the checklist. The text and type are what the step had
// when the run started, so they stay the same after the step is edited or deleted.
export type RunStep = {
  stepId: number | null
  text: string
  type: StepType
  isDone: boolean
  completedAt: string | null
  // The value entered for a text step.
  responseText: string | null
}

// A checkbox step sends isDone. A text step sends its text, and is done when the text isn't empty.
export type RunStepUpdate = { isDone: boolean } | { text: string }

export type ChecklistRun = {
  id: number
  checklistId: number
  checklistName: string
  startedAt: string
  completedAt: string | null
  steps: RunStep[]
}

type ErrorResponse = {
  message?: string
}

const runsUrl = `${apiBaseUrl}/api/runs`

const completedMessage = "This run is complete and can't be changed."

// A 409 means the run was already completed, for example in another tab.
async function throwIfCompleted(response: Response) {
  if (response.status === 409) {
    const error = (await response.json()) as ErrorResponse
    throw new ApiError(409, error.message ?? completedMessage)
  }
}

export async function startRun(checklistId: number) {
  const response = await fetch(
    `${apiBaseUrl}/api/checklists/${checklistId}/runs`,
    { method: 'POST' },
  )
  if (!response.ok) {
    throw new Error('Unable to start filling out the checklist.')
  }
  return (await response.json()) as ChecklistRun
}

// Returns null when there's no run with this id.
export async function getRun(id: number): Promise<ChecklistRun | null> {
  const response = await fetch(`${runsUrl}/${id}`)
  if (response.status === 404) {
    return null
  }
  if (!response.ok) {
    throw new Error('Unable to load this fill-out.')
  }
  return (await response.json()) as ChecklistRun
}

export async function saveRunStep(
  runId: number,
  stepId: number,
  update: RunStepUpdate,
) {
  const response = await fetch(`${runsUrl}/${runId}/steps/${stepId}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(update),
  })

  await throwIfCompleted(response)
  if (!response.ok) {
    throw new Error('Unable to save step.')
  }
  return (await response.json()) as RunStep
}

export async function completeRun(runId: number) {
  const response = await fetch(`${runsUrl}/${runId}/complete`, {
    method: 'POST',
  })

  await throwIfCompleted(response)
  if (!response.ok) {
    throw new Error('Unable to complete this fill-out.')
  }
  return (await response.json()) as ChecklistRun
}
