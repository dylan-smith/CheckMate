import { describe, expect, it } from 'vitest'
import type { ChecklistDetail, ChecklistStep } from '../api/checklists'
import {
  checklistFileName,
  parseChecklistYaml,
  toChecklistYaml,
} from '../checklistFile'

function step(
  id: number,
  text: string,
  extra: Partial<ChecklistStep> = {},
): ChecklistStep {
  return {
    id,
    text,
    type: 'Checkbox',
    sortOrder: id,
    options: [],
    dependsOnStepIds: [],
    ...extra,
  }
}

const preflight: ChecklistDetail = {
  id: 3,
  name: 'Pre-flight',
  steps: [
    step(10, 'Walk around the aircraft'),
    step(11, 'Fuel on board', { type: 'Number' }),
    step(12, 'Weather', {
      type: 'Choice',
      options: [
        { id: 1, text: 'Clear' },
        { id: 2, text: 'Rain' },
      ],
    }),
    step(13, 'Take off', { dependsOnStepIds: [10, 12] }),
  ],
}

describe('toChecklistYaml', () => {
  it('writes the checklist, leaving out defaults and only giving depended-on steps an id', () => {
    expect(toChecklistYaml(preflight))
      .toBe(`# CheckMate checklist. Import it from the checklists page.

checkmate: 1
name: Pre-flight
steps:
  - id: walk-around-the-aircraft
    text: Walk around the aircraft
  - text: Fuel on board
    type: Number
  - id: weather
    text: Weather
    type: Choice
    options:
      - Clear
      - Rain
  - text: Take off
    dependsOn:
      - walk-around-the-aircraft
      - weather
`)
  })

  it('numbers ids that would clash and names steps whose text makes no id', () => {
    const yaml = toChecklistYaml({
      id: 1,
      name: 'Repeats',
      steps: [
        step(1, 'Check'),
        step(2, 'check!'),
        step(3, '✓✓'),
        step(4, 'Done', { dependsOnStepIds: [1, 2, 3] }),
      ],
    })

    expect(parseChecklistYaml(yaml).steps.map((item) => item.id)).toEqual([
      'check',
      'check-2',
      'step-3',
      undefined,
    ])
  })

  it('reads back as the same checklist', () => {
    expect(parseChecklistYaml(toChecklistYaml(preflight))).toEqual({
      name: 'Pre-flight',
      steps: [
        {
          id: 'walk-around-the-aircraft',
          text: 'Walk around the aircraft',
          type: 'Checkbox',
        },
        { text: 'Fuel on board', type: 'Number' },
        {
          id: 'weather',
          text: 'Weather',
          type: 'Choice',
          options: ['Clear', 'Rain'],
        },
        {
          text: 'Take off',
          type: 'Checkbox',
          dependsOn: ['walk-around-the-aircraft', 'weather'],
        },
      ],
    })
  })
})

describe('parseChecklistYaml', () => {
  it('accepts hand-written shorthand', () => {
    expect(
      parseChecklistYaml(`checkmate: 1
name: Quick
steps:
  - Just a checkbox
  - id: 7
    text: 42
    type: choice
    options: [Yes, No]
  - text: Last
    dependsOn: 7
`),
    ).toEqual({
      name: 'Quick',
      steps: [
        { text: 'Just a checkbox', type: 'Checkbox' },
        { id: '7', text: '42', type: 'Choice', options: ['Yes', 'No'] },
        { text: 'Last', type: 'Checkbox', dependsOn: ['7'] },
      ],
    })
  })

  it('accepts a checklist with no steps', () => {
    expect(parseChecklistYaml('checkmate: 1\nname: Empty\n')).toEqual({
      name: 'Empty',
      steps: [],
    })
  })

  it.each([
    ['name: [unclosed', /^This file isn't valid YAML: /],
    ['name: No version\nsteps: []', "This file isn't a CheckMate checklist."],
    ['just text', "This file isn't a CheckMate checklist."],
    [
      'checkmate: 2\nname: Future',
      "This checklist file is from a newer version of CheckMate, so it can't be imported.",
    ],
    ['checkmate: 1\nname: "  "', 'The checklist file must have a name.'],
    [
      'checkmate: 1\nname: A\nsteps: nope',
      "The checklist file's steps must be a list.",
    ],
    ['checkmate: 1\nname: A\nsteps:\n  - type: Number', 'Step 1 needs text.'],
    [
      'checkmate: 1\nname: A\nsteps:\n  - text: A\n    type: Date',
      'Step 1 has an unknown type. Use Checkbox, Text, Number or Choice.',
    ],
    [
      'checkmate: 1\nname: A\nsteps:\n  - text: A\n    options: [{ a: 1 }]',
      "Step 1's options must be a list of text.",
    ],
  ])('rejects %j', (text, message) => {
    expect(() => parseChecklistYaml(text)).toThrow(message)
  })
})

describe('checklistFileName', () => {
  it.each([
    ['Pre-flight checks', 'pre-flight-checks.yml'],
    ['Café / Bar', 'cafe-bar.yml'],
    ['!!!', 'checklist.yml'],
  ])('names %j as %j', (name, fileName) => {
    expect(checklistFileName(name)).toBe(fileName)
  })
})
