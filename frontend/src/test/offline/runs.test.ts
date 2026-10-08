import { describe, expect, it } from 'vitest'
import type { ChecklistDetail } from '../../api/checklists'
import {
  applyStepUpdate,
  bump,
  createLocalRun,
  fromServerRun,
  stepChangeError,
  toSyncBody,
  unfinishedSteps,
} from '../../offline/runs'

const now = '2026-10-08T08:00:00Z'

const checklist: ChecklistDetail = {
  id: 3,
  name: 'Pre-dive',
  steps: [
    {
      id: 12,
      text: 'Check oxygen',
      type: 'Number',
      sortOrder: 1,
      options: [],
      dependsOnStepIds: [11],
    },
    {
      id: 11,
      text: 'Open valves',
      type: 'Checkbox',
      sortOrder: 0,
      options: [],
      dependsOnStepIds: [],
    },
    {
      id: 13,
      text: 'Weather',
      type: 'Choice',
      sortOrder: 2,
      options: [
        { id: 1, text: 'Calm' },
        { id: 2, text: 'Choppy' },
      ],
      dependsOnStepIds: [],
    },
    {
      id: 14,
      text: 'Notes',
      type: 'Text',
      sortOrder: 3,
      options: [],
      dependsOnStepIds: [],
    },
  ],
}

const key = 'c0ffee00-0000-4000-8000-000000000001'

describe('a new fill-out', () => {
  it('copies the steps in order, none done, and is dirty', () => {
    const run = createLocalRun(checklist, key, now)

    expect(run).toMatchObject({
      clientKey: key,
      serverId: null,
      checklistId: 3,
      checklistName: 'Pre-dive',
      startedAt: now,
      completedAt: null,
      revision: 1,
      syncedRevision: 0,
      syncError: null,
      deletedAt: null,
    })
    expect(run.steps.map((step) => [step.stepId, step.sortOrder])).toEqual([
      [11, 0],
      [12, 1],
      [13, 2],
      [14, 3],
    ])
    expect(run.steps.every((step) => !step.isDone)).toBe(true)
    expect(run.steps[2]?.options).toEqual(checklist.steps[2]?.options)
  })
})

describe('answering a step', () => {
  const run = createLocalRun(checklist, key, now)
  const [valves, oxygen, weather, notes] = run.steps as [
    (typeof run.steps)[number],
    (typeof run.steps)[number],
    (typeof run.steps)[number],
    (typeof run.steps)[number],
  ]
  const later = '2026-10-08T08:05:00Z'

  it('ticks a checkbox step at the time given, and un-ticks it', () => {
    const ticked = applyStepUpdate(valves, { isDone: true }, later)
    expect(ticked).toMatchObject({ isDone: true, completedAt: later })
    // Already done, so the time it was done stays.
    expect(
      applyStepUpdate(ticked, { isDone: true }, '2026-10-08T09:00:00Z'),
    ).toMatchObject({ completedAt: later })
    expect(applyStepUpdate(ticked, { isDone: false }, later)).toMatchObject({
      isDone: false,
      completedAt: null,
    })
  })

  it('trims text, and an empty text is no answer', () => {
    expect(applyStepUpdate(notes, { text: '  Fine  ' }, later)).toMatchObject({
      responseText: 'Fine',
      isDone: true,
      completedAt: later,
    })
    expect(applyStepUpdate(notes, { text: '   ' }, later)).toMatchObject({
      responseText: null,
      isDone: false,
      completedAt: null,
    })
  })

  it('keeps a number, and null is no answer', () => {
    expect(applyStepUpdate(oxygen, { number: 1.2 }, later)).toMatchObject({
      responseNumber: 1.2,
      isDone: true,
    })
    expect(applyStepUpdate(oxygen, { number: null }, later)).toMatchObject({
      responseNumber: null,
      isDone: false,
    })
  })

  it('keeps the picked option and its text, and clears both', () => {
    const picked = applyStepUpdate(weather, { optionId: 2 }, later)
    expect(picked).toMatchObject({
      selectedOptionId: 2,
      selectedOptionText: 'Choppy',
      isDone: true,
    })
    expect(applyStepUpdate(picked, { optionId: null }, later)).toMatchObject({
      selectedOptionId: null,
      selectedOptionText: null,
      isDone: false,
    })
  })
})

describe('what the API would refuse', () => {
  const run = createLocalRun(checklist, key, now)

  it('a step whose prerequisite is not done', () => {
    expect(stepChangeError(run, 12, { number: 1 })).toBe(
      "This step can't be filled in until the steps it depends on are done.",
    )
  })

  it('un-doing a step a done step depends on', () => {
    const done = {
      ...run,
      steps: run.steps.map((step) =>
        applyStepUpdate(
          step,
          step.type === 'Number' ? { number: 1 } : { isDone: true },
          now,
        ),
      ),
    }
    expect(stepChangeError(done, 11, { isDone: false })).toBe(
      'Un-do "Check oxygen" first, since it depends on this step.',
    )
    expect(stepChangeError(done, 11, { isDone: true })).toBeNull()
  })

  it('a number that does not fit, and an option not on the step', () => {
    const open = {
      ...run,
      steps: run.steps.map((step) =>
        step.stepId === 11
          ? applyStepUpdate(step, { isDone: true }, now)
          : step,
      ),
    }
    expect(stepChangeError(open, 12, { number: 1234567890 })).toContain(
      'at most 9 digits',
    )
    expect(stepChangeError(open, 12, { number: 1.1234567 })).toContain(
      'at most 9 digits',
    )
    expect(stepChangeError(open, 12, { number: 999999999.999999 })).toBeNull()
    expect(stepChangeError(open, 13, { optionId: 9 })).toBe(
      "The option must be one of this step's options.",
    )
    expect(stepChangeError(open, 13, { optionId: 1 })).toBeNull()
  })
})

describe('completing', () => {
  it('needs every step done, except ones deleted from the checklist', () => {
    const run = createLocalRun(checklist, key, now)
    expect(unfinishedSteps(run).map((step) => step.stepId)).toEqual([
      11, 12, 13, 14,
    ])
    const withDeleted = {
      ...run,
      steps: run.steps.map((step) =>
        step.stepId === 14 ? { ...step, stepId: null } : step,
      ),
    }
    expect(unfinishedSteps(withDeleted).map((step) => step.stepId)).toEqual([
      11, 12, 13,
    ])
  })
})

describe('sending to the API', () => {
  it('sends each step as shown, in order, leaving out deleted ones', () => {
    const run = createLocalRun(checklist, key, now)
    const answered = {
      ...run,
      completedAt: '2026-10-08T09:00:00Z',
      steps: [
        { ...run.steps[3], stepId: null },
        applyStepUpdate(run.steps[0], { isDone: true }, now),
        run.steps[1],
        run.steps[2],
      ],
    }

    expect(toSyncBody(answered)).toEqual({
      startedAt: now,
      completedAt: '2026-10-08T09:00:00Z',
      steps: [
        {
          stepId: 11,
          text: 'Open valves',
          type: 'Checkbox',
          isDone: true,
          completedAt: now,
          responseText: null,
          responseNumber: null,
          selectedOptionId: null,
          selectedOptionText: null,
        },
        expect.objectContaining({ stepId: 12 }),
        expect.objectContaining({ stepId: 13 }),
      ],
    })
  })

  it('counts a change, and drops a rejection but not a conflict', () => {
    const run = createLocalRun(checklist, key, now)
    const rejected = {
      ...run,
      syncError: {
        kind: 'rejected' as const,
        message: 'No',
        revision: 1,
        at: now,
      },
    }
    expect(bump(rejected, '2026-10-08T08:01:00Z')).toMatchObject({
      revision: 2,
      updatedAt: '2026-10-08T08:01:00Z',
      syncError: null,
    })
    const conflict = {
      ...run,
      syncError: { kind: 'conflict' as const, message: 'Done', at: now },
    }
    expect(bump(conflict, now).syncError).toEqual(conflict.syncError)
  })
})

describe('a fill-out from the API', () => {
  it('is kept as the API has it, with nothing to sync', () => {
    const local = fromServerRun(
      {
        id: 5,
        clientKey: key,
        checklistId: 3,
        checklistName: 'Pre-dive',
        startedAt: now,
        completedAt: null,
        steps: [
          {
            stepId: 11,
            text: 'Open valves',
            type: 'Checkbox',
            isDone: true,
            completedAt: now,
            responseText: null,
            responseNumber: null,
            options: [],
            selectedOptionId: null,
            selectedOptionText: null,
            dependsOnStepIds: [],
            isLocked: false,
          },
        ],
      },
      now,
    )

    expect(local).toMatchObject({
      clientKey: key,
      serverId: 5,
      revision: 0,
      syncedRevision: 0,
      syncedAt: now,
      steps: [{ stepId: 11, sortOrder: 0, isDone: true }],
    })
  })
})
