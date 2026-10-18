import { Document, parse, YAMLError } from 'yaml'
import { stepTypes } from './api/checklists'
import type {
  ChecklistDetail,
  ChecklistImport,
  ChecklistImportStep,
  StepType,
} from './api/checklists'

// The version of the file format, so a later change to it can still read older files or explain a newer one.
const formatVersion = 1

const header = ' CheckMate checklist. Import it from the checklists page.'

// A problem with the file, which the user can fix by choosing or editing another one.
export class ChecklistFileError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ChecklistFileError'
  }
}

// A lowercase, dash-separated version of the text that's safe in a file name or as a step's id, or '' when the
// text has no letters or digits.
function slugify(text: string, maxLength: number) {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+/, '')
    .slice(0, maxLength)
    .replace(/-+$/, '')
}

export function checklistFileName(name: string) {
  return `${slugify(name, 60) || 'checklist'}.yml`
}

// Only steps that others depend on need an id in the file. Each is made from the step's text, numbered when
// another step's text makes the same one.
function stepKeys(detail: ChecklistDetail) {
  const needed = new Set(detail.steps.flatMap((step) => step.dependsOnStepIds))
  const used = new Set<string>()
  const keys = new Map<number, string>()

  detail.steps.forEach((step, index) => {
    if (!needed.has(step.id)) {
      return
    }
    const base = slugify(step.text, 40) || `step-${index + 1}`
    let key = base
    for (let number = 2; used.has(key); number++) {
      key = `${base}-${number}`
    }
    used.add(key)
    keys.set(step.id, key)
  })

  return keys
}

// Leaves out what an import would assume anyway (a checkbox step, no options, no prerequisites) to keep the file
// short and easy to edit by hand.
export function toChecklistYaml(detail: ChecklistDetail) {
  const keys = stepKeys(detail)
  const steps = detail.steps.map((step) => {
    const dependsOn = step.dependsOnStepIds.flatMap((id) => keys.get(id) ?? [])
    return {
      ...(keys.has(step.id) && { id: keys.get(step.id) }),
      text: step.text,
      ...(step.type !== 'Checkbox' && { type: step.type }),
      ...(step.options.length > 0 && {
        options: step.options.map((option) => option.text),
      }),
      ...(dependsOn.length > 0 && { dependsOn }),
    }
  })

  const document = new Document({
    checkmate: formatVersion,
    name: detail.name,
    steps,
  })
  document.commentBefore = header
  return document.toString()
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

// YAML reads `text: 42` or `id: yes` as a number or boolean, but they're meant as text.
function asText(value: unknown) {
  return typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
    ? String(value)
    : undefined
}

function asTextList(value: unknown, what: string) {
  if (value == null) {
    return undefined
  }
  const items = Array.isArray(value) ? value : [value]
  return items.map((item) => {
    const text = asText(item)
    if (text === undefined) {
      throw new ChecklistFileError(`${what} must be a list of text.`)
    }
    return text
  })
}

function parseStep(value: unknown, index: number): ChecklistImportStep {
  const label = `Step ${index + 1}`
  // A step can be just its text, for a checkbox step nothing depends on.
  const text = asText(value)
  if (text !== undefined) {
    return { text, type: 'Checkbox' }
  }
  if (!isObject(value)) {
    throw new ChecklistFileError(`${label} needs text.`)
  }

  const stepText = asText(value.text)
  if (stepText === undefined) {
    throw new ChecklistFileError(`${label} needs text.`)
  }

  let type: StepType = 'Checkbox'
  if (value.type != null) {
    const typeText = asText(value.type)?.toLowerCase()
    const match = stepTypes.find(
      (stepType) => stepType.toLowerCase() === typeText,
    )
    if (match === undefined) {
      throw new ChecklistFileError(
        `${label} has an unknown type. Use ${stepTypes.slice(0, -1).join(', ')} or ${stepTypes.at(-1)}.`,
      )
    }
    type = match
  }

  const id = value.id == null ? undefined : asText(value.id)
  if (value.id != null && id === undefined) {
    throw new ChecklistFileError(`${label}'s id must be text.`)
  }

  return {
    ...(id !== undefined && { id }),
    text: stepText,
    type,
    options: asTextList(value.options, `${label}'s options`),
    dependsOn: asTextList(value.dependsOn, `${label}'s dependsOn`),
  }
}

// Reads a file made by toChecklistYaml, or written by hand in the same format. It only checks the file's shape:
// the API checks the rest, such as whether the options suit the step type.
export function parseChecklistYaml(text: string): ChecklistImport {
  let value: unknown
  try {
    value = parse(text)
  } catch (error) {
    if (error instanceof YAMLError) {
      throw new ChecklistFileError(
        `This file isn't valid YAML: ${error.message.split('\n')[0]}`,
      )
    }
    throw error
  }

  if (!isObject(value) || value.checkmate === undefined) {
    throw new ChecklistFileError("This file isn't a CheckMate checklist.")
  }
  if (value.checkmate !== formatVersion) {
    throw new ChecklistFileError(
      "This checklist file is from a newer version of CheckMate, so it can't be imported.",
    )
  }

  const name = asText(value.name)
  if (name === undefined || name.trim() === '') {
    throw new ChecklistFileError('The checklist file must have a name.')
  }

  if (value.steps != null && !Array.isArray(value.steps)) {
    throw new ChecklistFileError("The checklist file's steps must be a list.")
  }
  const steps = ((value.steps ?? []) as unknown[]).map(parseStep)

  return { name, steps }
}
