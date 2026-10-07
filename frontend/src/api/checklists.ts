import { apiBaseUrl } from '../config'

export type Checklist = {
  id: number
  name: string
}

// What a step asks for when the checklist is filled out, in the order the type picker lists them.
export const stepTypes = ['Checkbox', 'Text', 'Number', 'Choice'] as const

export type StepType = (typeof stepTypes)[number]

export const stepTypeLabels: Record<StepType, string> = {
  Checkbox: 'Checkbox',
  Text: 'Text input',
  Number: 'Number',
  Choice: 'Multiple choice',
}

export type StepOption = {
  id: number
  text: string
}

// An option as it's sent: one the step already has keeps its id, and a new one has none.
export type StepOptionInput = {
  id?: number
  text: string
}

// Only a choice step has options, in the order they're listed.
export type ChecklistStep = {
  id: number
  text: string
  type: StepType
  sortOrder: number
  options: StepOption[]
}

// A single checklist comes back with its steps in order.
export type ChecklistDetail = Checklist & {
  steps: ChecklistStep[]
}

type ErrorResponse = {
  message?: string
}

// Thrown for a response the caller should show to the user as is, such as a 409 for a duplicate name.
export class ApiError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

// fetch rejects with a TypeError when the API can't be reached at all, including while a deployment has
// it paused (see the deploy-backend job in ci.yml), so tell the user to retry rather than show a generic error.
export const unreachableMessage =
  "Can't reach CheckMate right now. It may be updating, so try again in a minute."

export function describeFetchError(error: unknown, fallback: string) {
  if (error instanceof TypeError) {
    return unreachableMessage
  }
  return error instanceof ApiError ? error.message : fallback
}

const checklistsUrl = `${apiBaseUrl}/api/checklists`

export async function listChecklists(): Promise<Checklist[]> {
  const response = await fetch(checklistsUrl)
  if (!response.ok) {
    throw new Error('Unable to load checklists.')
  }
  return (await response.json()) as Checklist[]
}

// Returns null when there's no checklist with this id.
export async function getChecklist(
  id: number,
): Promise<ChecklistDetail | null> {
  const response = await fetch(`${checklistsUrl}/${id}`)
  if (response.status === 404) {
    return null
  }
  if (!response.ok) {
    throw new Error('Unable to load checklist.')
  }
  return (await response.json()) as ChecklistDetail
}

async function saveChecklist(
  url: string,
  method: 'POST' | 'PUT',
  name: string,
) {
  const response = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ name }),
  })

  if (response.status === 409) {
    const error = (await response.json()) as ErrorResponse
    throw new ApiError(
      409,
      error.message ?? 'A checklist with this name already exists.',
    )
  }
  if (!response.ok) {
    throw new Error('Unable to save checklist.')
  }
  return (await response.json()) as Checklist
}

export function createChecklist(name: string) {
  return saveChecklist(checklistsUrl, 'POST', name)
}

export function updateChecklist(id: number, name: string) {
  return saveChecklist(`${checklistsUrl}/${id}`, 'PUT', name)
}

// A 404 means the checklist is already gone, which is what the caller wanted.
export async function deleteChecklist(id: number) {
  const response = await fetch(`${checklistsUrl}/${id}`, { method: 'DELETE' })
  if (!response.ok && response.status !== 404) {
    throw new Error('Unable to delete checklist.')
  }
}

function stepsUrl(checklistId: number) {
  return `${checklistsUrl}/${checklistId}/steps`
}

async function saveStep(
  url: string,
  method: 'POST' | 'PUT',
  text: string,
  type: StepType,
  options: StepOptionInput[],
) {
  const response = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ text, type, options }),
  })

  if (!response.ok) {
    throw new Error('Unable to save step.')
  }
  return (await response.json()) as ChecklistStep
}

// options are the choice step's options and replace the ones it had. Other types send none.
export function createStep(
  checklistId: number,
  text: string,
  type: StepType,
  options: StepOptionInput[] = [],
) {
  return saveStep(stepsUrl(checklistId), 'POST', text, type, options)
}

export function updateStep(
  checklistId: number,
  stepId: number,
  text: string,
  type: StepType,
  options: StepOptionInput[] = [],
) {
  return saveStep(
    `${stepsUrl(checklistId)}/${stepId}`,
    'PUT',
    text,
    type,
    options,
  )
}

// Takes every step id of the checklist in the new order and returns the steps in that order.
// A 400 means the list no longer matches the steps, for example because they were changed elsewhere.
export async function reorderSteps(checklistId: number, stepIds: number[]) {
  const response = await fetch(`${stepsUrl(checklistId)}/order`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ stepIds }),
  })

  if (response.status === 400) {
    throw new ApiError(
      400,
      'The steps have changed since this page loaded. Reload the page and try again.',
    )
  }
  if (!response.ok) {
    throw new Error('Unable to reorder steps.')
  }
  return (await response.json()) as ChecklistStep[]
}

// A 404 means the step is already gone, which is what the caller wanted.
export async function deleteStep(checklistId: number, stepId: number) {
  const response = await fetch(`${stepsUrl(checklistId)}/${stepId}`, {
    method: 'DELETE',
  })
  if (!response.ok && response.status !== 404) {
    throw new Error('Unable to delete step.')
  }
}
