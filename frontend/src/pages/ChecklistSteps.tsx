import { useEffect, useRef, useState } from 'react'
import type { ReactNode, SubmitEvent } from 'react'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import type { DragEndEvent, DragStartEvent, Modifier } from '@dnd-kit/core'
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import IconButton from '@mui/material/IconButton'
import List from '@mui/material/List'
import ListItem from '@mui/material/ListItem'
import ListItemText from '@mui/material/ListItemText'
import MenuItem from '@mui/material/MenuItem'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import {
  ApiError,
  createStep,
  deleteStep,
  describeFetchError,
  reorderSteps,
  stepTypeLabels,
  stepTypes,
  updateStep,
} from '../api/checklists'
import type {
  ChecklistStep,
  StepOptionInput,
  StepType,
} from '../api/checklists'
import { trackEvent, trackException } from '../telemetry'

type ChecklistStepsProps = {
  checklistId: number
  initialSteps: ChecklistStep[]
}

type MoveDirection = 'up' | 'down'

function moveButtonId(stepId: number, direction: MoveDirection) {
  return `step-${stepId}-move-${direction}`
}

// Steps only reorder up and down, so a dragged step doesn't wander sideways.
const restrictToVerticalAxis: Modifier = ({ transform }) => ({
  ...transform,
  x: 0,
})

type StepTypeFieldProps = {
  id: string
  value: StepType
  onChange: (type: StepType) => void
}

function StepTypeField({ id, value, onChange }: StepTypeFieldProps) {
  return (
    <TextField
      id={id}
      select
      label="Type"
      value={value}
      onChange={(event) => {
        // The menu only offers stepTypes, so this always finds one.
        const type = stepTypes.find((item) => item === event.target.value)
        if (type) {
          onChange(type)
        }
      }}
      size="small"
      sx={{ minWidth: 140 }}
    >
      {stepTypes.map((type) => (
        <MenuItem key={type} value={type}>
          {stepTypeLabels[type]}
        </MenuItem>
      ))}
    </TextField>
  )
}

// An option being edited. key tells the fields apart, including new options that have no id yet.
type OptionDraft = StepOptionInput & { key: number }

// Matches the API.
const minOptions = 2
const maxOptions = 50

let nextOptionKey = 0

function toDraft(option: StepOptionInput): OptionDraft {
  nextOptionKey += 1
  return { ...option, key: nextOptionKey }
}

function blankOptions() {
  return Array.from({ length: minOptions }, () => toDraft({ text: '' }))
}

// The options trimmed, ready to send, or why they can't be saved.
function checkOptions(
  options: OptionDraft[],
): { options: StepOptionInput[] } | { error: string } {
  const trimmed = options.map(({ id, text }) => ({ id, text: text.trim() }))
  if (trimmed.length < minOptions) {
    return {
      error: `A multiple choice step needs at least ${minOptions} options.`,
    }
  }
  if (trimmed.some((option) => !option.text)) {
    return { error: 'Option text is required.' }
  }
  const distinct = new Set(trimmed.map((option) => option.text.toLowerCase()))
  if (distinct.size !== trimmed.length) {
    return { error: 'Each option must be different.' }
  }
  return { options: trimmed }
}

type OptionsEditorProps = {
  idPrefix: string
  options: OptionDraft[]
  onChange: (options: OptionDraft[]) => void
}

// Lists a choice step's options, each of which can be edited, moved or removed, and adds new ones.
function OptionsEditor({ idPrefix, options, onChange }: OptionsEditorProps) {
  // A new option's field takes focus once it renders.
  const focusKey = useRef<number | null>(null)

  function move(index: number, targetIndex: number) {
    const reordered = [...options]
    ;[reordered[index], reordered[targetIndex]] = [
      reordered[targetIndex],
      reordered[index],
    ]
    onChange(reordered)
  }

  function add() {
    const option = toDraft({ text: '' })
    focusKey.current = option.key
    onChange([...options, option])
  }

  return (
    <Box
      component="fieldset"
      sx={{ border: 0, m: 0, p: 0, display: 'grid', gap: 1 }}
    >
      <Typography component="legend" variant="subtitle2" sx={{ mb: 1 }}>
        Options
      </Typography>
      {options.map((option, index) => {
        const label = `Option ${index + 1}`
        return (
          <Box
            key={option.key}
            sx={{ display: 'flex', alignItems: 'center', gap: 1 }}
          >
            <TextField
              id={`${idPrefix}-option-${option.key}`}
              label={label}
              value={option.text}
              onChange={(event) =>
                onChange(
                  options.map((item) =>
                    item.key === option.key
                      ? { ...item, text: event.target.value }
                      : item,
                  ),
                )
              }
              inputRef={(element: HTMLInputElement | null) => {
                if (element && focusKey.current === option.key) {
                  focusKey.current = null
                  element.focus()
                }
              }}
              slotProps={{ htmlInput: { maxLength: 200 } }}
              size="small"
              sx={{ flexGrow: 1 }}
            />
            <IconButton
              size="small"
              color="primary"
              sx={{ fontWeight: 'bold' }}
              disabled={index === 0}
              aria-label={`Move ${label.toLowerCase()} up`}
              onClick={() => move(index, index - 1)}
            >
              <span aria-hidden="true">↑</span>
            </IconButton>
            <IconButton
              size="small"
              color="primary"
              sx={{ fontWeight: 'bold' }}
              disabled={index === options.length - 1}
              aria-label={`Move ${label.toLowerCase()} down`}
              onClick={() => move(index, index + 1)}
            >
              <span aria-hidden="true">↓</span>
            </IconButton>
            <Button
              type="button"
              size="small"
              color="error"
              // A choice step always needs at least two options.
              disabled={options.length <= minOptions}
              aria-label={`Remove ${label.toLowerCase()}`}
              onClick={() =>
                onChange(options.filter((item) => item.key !== option.key))
              }
            >
              Remove
            </Button>
          </Box>
        )
      })}
      <Box>
        <Button
          type="button"
          size="small"
          disabled={options.length >= maxOptions}
          onClick={add}
        >
          Add option
        </Button>
      </Box>
    </Box>
  )
}

type PrerequisitesFieldProps = {
  id: string
  // The steps that can be picked, in checklist order.
  options: ChecklistStep[]
  value: number[]
  onChange: (stepIds: number[]) => void
}

function PrerequisitesField({
  id,
  options,
  value,
  onChange,
}: PrerequisitesFieldProps) {
  return (
    <TextField
      id={id}
      select
      label="Depends on"
      value={value}
      onChange={(event) => {
        // A multiple select gives the chosen values as an array, kept here in checklist order.
        const selected: unknown = event.target.value
        if (Array.isArray(selected)) {
          onChange(
            options
              .filter((step) => selected.includes(step.id))
              .map((step) => step.id),
          )
        }
      }}
      slotProps={{
        select: {
          multiple: true,
          // Shows "None" rather than an empty field, so the label has to stay above it.
          displayEmpty: true,
          renderValue: () => describePrerequisites(options, value) || 'None',
        },
        inputLabel: { shrink: true },
      }}
      size="small"
      sx={{ width: { xs: '100%', sm: 200 }, flexShrink: 0 }}
    >
      {options.map((step) => (
        <MenuItem key={step.id} value={step.id}>
          {/* The option is already announced as selected, so the check mark is only visual. */}
          <Box
            component="span"
            aria-hidden="true"
            sx={{ width: 24, flexShrink: 0, fontWeight: 'bold' }}
          >
            {value.includes(step.id) ? '✓' : ''}
          </Box>
          <ListItemText
            primary={step.text}
            sx={{ my: 0, overflowWrap: 'anywhere' }}
          />
        </MenuItem>
      ))}
    </TextField>
  )
}

// The text of the steps a step depends on, in checklist order.
function describePrerequisites(steps: ChecklistStep[], stepIds: number[]) {
  return steps
    .filter((step) => stepIds.includes(step.id))
    .map((step) => step.text)
    .join(', ')
}

// The hint under a step in the list, or undefined when there's nothing to add.
function describeStep(step: ChecklistStep, steps: ChecklistStep[]) {
  const prerequisites = describePrerequisites(steps, step.dependsOnStepIds)
  const parts = [
    // Checkbox is the usual type, so only the others are called out, and a choice step with its options.
    step.type === 'Checkbox'
      ? ''
      : step.type === 'Choice'
        ? `${stepTypeLabels.Choice}: ${step.options.map((option) => option.text).join(', ')}`
        : stepTypeLabels[step.type],
    prerequisites && `Depends on: ${prerequisites}`,
  ].filter(Boolean)
  return parts.length > 0 ? parts.join(' · ') : undefined
}

type DragHandleProps = {
  step: ChecklistStep
  disabled: boolean
  activatorRef?: (element: HTMLElement | null) => void
  listeners?: ReturnType<typeof useSortable>['listeners']
}

// Keyboard and screen reader users reorder with the move buttons instead.
function DragHandle({
  step,
  disabled,
  activatorRef,
  listeners,
}: DragHandleProps) {
  return (
    <Box
      ref={activatorRef}
      component="span"
      aria-hidden="true"
      title={`Drag to reorder step "${step.text}"`}
      {...listeners}
      sx={{
        px: 0.5,
        color: 'text.secondary',
        cursor: disabled ? 'default' : 'grab',
        userSelect: 'none',
        // Lets a touch on the handle drag the step instead of scrolling the page.
        touchAction: 'none',
        fontSize: '1.25rem',
        lineHeight: 1,
        // Drawn by CSS so the glyph isn't part of the step's text.
        '&::before': { content: '"⠿"' },
      }}
    />
  )
}

type SortableStepProps = {
  step: ChecklistStep
  disabled: boolean
  children: (handle: ReactNode) => ReactNode
}

function SortableStep({ step, disabled, children }: SortableStepProps) {
  const {
    setNodeRef,
    setActivatorNodeRef,
    listeners,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: step.id, disabled })

  return (
    <ListItem
      ref={setNodeRef}
      divider
      disableGutters
      sx={{
        transform: CSS.Translate.toString(transform),
        transition,
        // While its copy is dragged around, the step's place in the list shows as an empty slot.
        ...(isDragging && {
          bgcolor: 'action.hover',
          outline: '2px dashed',
          outlineColor: 'divider',
          outlineOffset: '-2px',
          '& > *': { visibility: 'hidden' },
        }),
      }}
    >
      {children(
        <DragHandle
          step={step}
          disabled={disabled}
          activatorRef={setActivatorNodeRef}
          listeners={listeners}
        />,
      )}
    </ListItem>
  )
}

function ChecklistSteps({ checklistId, initialSteps }: ChecklistStepsProps) {
  const [steps, setSteps] = useState(initialSteps)
  const [newText, setNewText] = useState('')
  const [newType, setNewType] = useState<StepType>('Checkbox')
  const [newOptions, setNewOptions] = useState<OptionDraft[]>([])
  const [newDependsOn, setNewDependsOn] = useState<number[]>([])
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editText, setEditText] = useState('')
  const [editType, setEditType] = useState<StepType>('Checkbox')
  const [editOptions, setEditOptions] = useState<OptionDraft[]>([])
  const [editDependsOn, setEditDependsOn] = useState<number[]>([])
  // Only one change runs at a time, so the list can't get out of step with the API.
  const [busy, setBusy] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  // Read out by screen readers, since a moved step otherwise changes place silently.
  const [moveAnnouncement, setMoveAnnouncement] = useState('')
  const [draggingId, setDraggingId] = useState<number | null>(null)
  // Dragging is for pointers only, so dnd-kit's own screen reader text goes in a hidden element
  // instead of adding a second status next to moveAnnouncement.
  const [dragA11yContainer, setDragA11yContainer] =
    useState<HTMLElement | null>(null)
  // The move buttons are disabled while a move saves, which drops keyboard focus, so it's put back here.
  const focusAfterMove = useRef<{
    stepId: number
    direction: MoveDirection
  } | null>(null)
  // A small movement before a drag starts, so a click on the handle doesn't count as one.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  )

  useEffect(() => {
    if (busy || !focusAfterMove.current) {
      return
    }
    const { stepId, direction } = focusAfterMove.current
    focusAfterMove.current = null
    const directions: MoveDirection[] =
      direction === 'up' ? ['up', 'down'] : ['down', 'up']
    // A step moved to the top or bottom can't move further that way, so focus goes to its other button.
    const button = directions
      .map((item) => document.getElementById(moveButtonId(stepId, item)))
      .find((item) => item instanceof HTMLButtonElement && !item.disabled)
    button?.focus()
  }, [busy])

  // Only a choice step sends options. Returns null after showing why they can't be saved.
  function optionsToSave(type: StepType, options: OptionDraft[]) {
    if (type !== 'Choice') {
      return []
    }
    const checked = checkOptions(options)
    if ('error' in checked) {
      setErrorMessage(checked.error)
      return null
    }
    return checked.options
  }

  // A step switched to multiple choice starts with blank options to fill in.
  function changeNewType(type: StepType) {
    setNewType(type)
    if (type === 'Choice' && newOptions.length === 0) {
      setNewOptions(blankOptions())
    }
  }

  function changeEditType(type: StepType) {
    setEditType(type)
    if (type === 'Choice' && editOptions.length === 0) {
      setEditOptions(blankOptions())
    }
  }

  async function handleAdd(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()

    const trimmedText = newText.trim()
    if (!trimmedText) {
      setErrorMessage('Step text is required.')
      return
    }
    const options = optionsToSave(newType, newOptions)
    if (!options) {
      return
    }

    setBusy(true)
    setErrorMessage('')

    try {
      const created = await createStep(checklistId, {
        text: trimmedText,
        type: newType,
        options,
        dependsOnStepIds: newDependsOn,
      })
      trackEvent('StepAdded')
      setSteps((current) => [...current, created])
      setNewText('')
      setNewType('Checkbox')
      setNewOptions([])
      setNewDependsOn([])
    } catch (error) {
      // A rejected step, such as one whose prerequisite was deleted elsewhere, is the user's to fix, not a failure
      // to report.
      if (!(error instanceof ApiError)) {
        trackException(error, { operation: 'addStep' })
      }
      setErrorMessage(describeFetchError(error, 'Unable to save step.'))
    } finally {
      setBusy(false)
    }
  }

  function startEditing(step: ChecklistStep) {
    setEditingId(step.id)
    setEditText(step.text)
    setEditType(step.type)
    setEditOptions(step.options.map(toDraft))
    setEditDependsOn(step.dependsOnStepIds)
    setErrorMessage('')
  }

  // Any error was about the edit, so it goes away with the edit field.
  function cancelEditing() {
    setEditingId(null)
    setErrorMessage('')
  }

  async function handleUpdate(
    event: SubmitEvent<HTMLFormElement>,
    stepId: number,
  ) {
    event.preventDefault()

    const trimmedText = editText.trim()
    if (!trimmedText) {
      setErrorMessage('Step text is required.')
      return
    }
    const options = optionsToSave(editType, editOptions)
    if (!options) {
      return
    }

    setBusy(true)
    setErrorMessage('')

    try {
      const saved = await updateStep(checklistId, stepId, {
        text: trimmedText,
        type: editType,
        options,
        dependsOnStepIds: editDependsOn,
      })
      trackEvent('StepUpdated')
      setSteps((current) =>
        current.map((step) => (step.id === saved.id ? saved : step)),
      )
      setEditingId(null)
    } catch (error) {
      // A rejected change, such as prerequisites that make a cycle, or an option picked while saving is the user's
      // to fix or try again, not a failure to report.
      if (!(error instanceof ApiError)) {
        trackException(error, { operation: 'updateStep' })
      }
      setErrorMessage(describeFetchError(error, 'Unable to save step.'))
    } finally {
      setBusy(false)
    }
  }

  async function handleDelete(stepId: number) {
    setBusy(true)
    setErrorMessage('')

    try {
      await deleteStep(checklistId, stepId)
      trackEvent('StepDeleted')
      // The API also takes the step out of other steps' prerequisites, so do the same here.
      setSteps((current) =>
        current
          .filter((step) => step.id !== stepId)
          .map((step) =>
            step.dependsOnStepIds.includes(stepId)
              ? {
                  ...step,
                  dependsOnStepIds: step.dependsOnStepIds.filter(
                    (id) => id !== stepId,
                  ),
                }
              : step,
          ),
      )
      // An open editor or the new step may have picked it too, and saving either would be rejected.
      setEditDependsOn((current) => current.filter((id) => id !== stepId))
      setNewDependsOn((current) => current.filter((id) => id !== stepId))
      if (editingId === stepId) {
        setEditingId(null)
      }
    } catch (error) {
      trackException(error, { operation: 'deleteStep' })
      setErrorMessage(describeFetchError(error, 'Unable to delete step.'))
    } finally {
      setBusy(false)
    }
  }

  // The direction is set for the move buttons, so keyboard focus can be put back on the step.
  async function moveStep(
    index: number,
    targetIndex: number,
    direction?: MoveDirection,
  ) {
    const previous = steps
    const reordered = [...steps]
    const [moved] = reordered.splice(index, 1)
    reordered.splice(targetIndex, 0, moved)

    // The step moves straight away, so a dropped step stays where it was dropped while it saves.
    setSteps(reordered)
    setBusy(true)
    setErrorMessage('')
    setMoveAnnouncement('')

    try {
      const saved = await reorderSteps(
        checklistId,
        reordered.map((step) => step.id),
      )
      trackEvent('StepsReordered')
      setSteps(saved)
      setMoveAnnouncement(
        `Moved step "${moved.text}" to position ${targetIndex + 1} of ${saved.length}.`,
      )
    } catch (error) {
      setSteps(previous)
      // Steps changed elsewhere are the user's to reload, not a failure to report.
      if (!(error instanceof ApiError)) {
        trackException(error, { operation: 'reorderSteps' })
      }
      setErrorMessage(describeFetchError(error, 'Unable to reorder steps.'))
    } finally {
      if (direction) {
        focusAfterMove.current = { stepId: moved.id, direction }
      }
      setBusy(false)
    }
  }

  function handleMove(index: number, direction: MoveDirection) {
    return moveStep(
      index,
      direction === 'up' ? index - 1 : index + 1,
      direction,
    )
  }

  function handleDragStart({ active }: DragStartEvent) {
    setDraggingId(Number(active.id))
  }

  function handleDragEnd({ active, over }: DragEndEvent) {
    setDraggingId(null)
    const index = steps.findIndex((step) => step.id === active.id)
    const targetIndex = steps.findIndex((step) => step.id === over?.id)
    if (index !== -1 && targetIndex !== -1 && index !== targetIndex) {
      void moveStep(index, targetIndex)
    }
  }

  // The dragged copy leaves out the ids, which belong to the step in the list.
  function stepRow(
    step: ChecklistStep,
    index: number,
    handle: ReactNode,
    isCopy = false,
  ) {
    return (
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          width: '100%',
        }}
      >
        {handle}
        <ListItemText
          primary={step.text}
          secondary={describeStep(step, steps)}
          sx={{ overflowWrap: 'anywhere' }}
        />
        <Stack direction="row" spacing={1}>
          <IconButton
            id={isCopy ? undefined : moveButtonId(step.id, 'up')}
            size="small"
            color="primary"
            sx={{ fontWeight: 'bold' }}
            disabled={busy || index === 0}
            aria-label={`Move step "${step.text}" up`}
            onClick={() => void handleMove(index, 'up')}
          >
            <span aria-hidden="true">↑</span>
          </IconButton>
          <IconButton
            id={isCopy ? undefined : moveButtonId(step.id, 'down')}
            size="small"
            color="primary"
            sx={{ fontWeight: 'bold' }}
            disabled={busy || index === steps.length - 1}
            aria-label={`Move step "${step.text}" down`}
            onClick={() => void handleMove(index, 'down')}
          >
            <span aria-hidden="true">↓</span>
          </IconButton>
          <Button
            type="button"
            size="small"
            disabled={busy}
            aria-label={`Edit step "${step.text}"`}
            onClick={() => startEditing(step)}
          >
            Edit
          </Button>
          <Button
            type="button"
            size="small"
            color="error"
            disabled={busy}
            aria-label={`Delete step "${step.text}"`}
            onClick={() => void handleDelete(step.id)}
          >
            Delete
          </Button>
        </Stack>
      </Box>
    )
  }

  const draggingIndex = steps.findIndex((step) => step.id === draggingId)
  const draggingStep = draggingIndex === -1 ? null : steps[draggingIndex]

  return (
    <Paper component="section" elevation={2} sx={{ p: 3 }}>
      <Typography variant="h6" component="h3" sx={{ mb: 2 }}>
        Steps
      </Typography>

      <Box
        role="status"
        sx={{
          position: 'absolute',
          width: '1px',
          height: '1px',
          m: '-1px',
          p: 0,
          border: 0,
          overflow: 'hidden',
          clip: 'rect(0 0 0 0)',
          whiteSpace: 'nowrap',
        }}
      >
        {moveAnnouncement}
      </Box>
      <Box ref={setDragA11yContainer} sx={{ display: 'none' }} />

      {errorMessage && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {errorMessage}
        </Alert>
      )}

      {steps.length === 0 ? (
        <Typography color="text.secondary" sx={{ mb: 2 }}>
          No steps yet.
        </Typography>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          modifiers={[restrictToVerticalAxis]}
          // The steps are often near the bottom of the window, so the page only scrolls when a step
          // is dragged right to the edge, not whenever it's over the last few steps.
          autoScroll={{ threshold: { x: 0, y: 0.1 } }}
          accessibility={{ container: dragA11yContainer ?? undefined }}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onDragCancel={() => setDraggingId(null)}
        >
          <SortableContext
            items={steps.map((step) => step.id)}
            strategy={verticalListSortingStrategy}
          >
            <List disablePadding sx={{ mb: 2 }}>
              {steps.map((step, index) => (
                <SortableStep key={step.id} step={step} disabled={busy}>
                  {(handle) =>
                    editingId === step.id ? (
                      <Box
                        component="form"
                        aria-label={`Edit step "${step.text}"`}
                        onSubmit={(event) => void handleUpdate(event, step.id)}
                        sx={{ display: 'grid', gap: 1, width: '100%' }}
                      >
                        <Box
                          sx={{
                            display: 'flex',
                            flexDirection: { xs: 'column', sm: 'row' },
                            // The type and prerequisite fields leave the text too little room on one row until
                            // md, so below that the text gets a line of its own.
                            flexWrap: { sm: 'wrap', md: 'nowrap' },
                            gap: 1,
                          }}
                        >
                          <TextField
                            id={`step-${step.id}-text`}
                            label="Step text"
                            value={editText}
                            onChange={(event) =>
                              setEditText(event.target.value)
                            }
                            slotProps={{ htmlInput: { maxLength: 500 } }}
                            required
                            size="small"
                            sx={{
                              flexGrow: 1,
                              flexBasis: { sm: '100%', md: 'auto' },
                            }}
                          />
                          <StepTypeField
                            id={`step-${step.id}-type`}
                            value={editType}
                            onChange={changeEditType}
                          />
                          {steps.length > 1 && (
                            <PrerequisitesField
                              id={`step-${step.id}-depends-on`}
                              options={steps.filter(
                                (item) => item.id !== step.id,
                              )}
                              value={editDependsOn}
                              onChange={setEditDependsOn}
                            />
                          )}
                          <Stack direction="row" spacing={1}>
                            <Button
                              type="submit"
                              variant="contained"
                              disabled={busy}
                            >
                              Save
                            </Button>
                            <Button
                              type="button"
                              disabled={busy}
                              onClick={cancelEditing}
                            >
                              Cancel
                            </Button>
                          </Stack>
                        </Box>
                        {editType === 'Choice' && (
                          <OptionsEditor
                            idPrefix={`step-${step.id}`}
                            options={editOptions}
                            onChange={setEditOptions}
                          />
                        )}
                      </Box>
                    ) : (
                      stepRow(step, index, handle)
                    )
                  }
                </SortableStep>
              ))}
            </List>
          </SortableContext>
          <DragOverlay>
            {draggingStep && (
              // A see-through copy of the step follows the pointer. It's only a picture, so it's inert.
              <Paper
                inert
                elevation={8}
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  height: '100%',
                  // The card reaches out past the step, so its contents line up with the list's.
                  mx: -1,
                  px: 1,
                  opacity: 0.85,
                  cursor: 'grabbing',
                }}
              >
                {stepRow(
                  draggingStep,
                  draggingIndex,
                  <DragHandle step={draggingStep} disabled={false} />,
                  true,
                )}
              </Paper>
            )}
          </DragOverlay>
        </DndContext>
      )}

      <Box
        component="form"
        aria-label="Add a step"
        onSubmit={(event) => void handleAdd(event)}
        sx={{ display: 'grid', gap: 1 }}
      >
        <Box
          sx={{
            display: 'flex',
            flexDirection: { xs: 'column', sm: 'row' },
            // Like the edit form, the text gets a line of its own until md once there's a prerequisite field.
            flexWrap: { sm: 'wrap', md: 'nowrap' },
            gap: 1,
          }}
        >
          <TextField
            id="new-step"
            label="New step"
            value={newText}
            onChange={(event) => setNewText(event.target.value)}
            slotProps={{ htmlInput: { maxLength: 500 } }}
            size="small"
            sx={{
              flexGrow: 1,
              ...(steps.length > 0 && {
                flexBasis: { sm: '100%', md: 'auto' },
              }),
            }}
          />
          <StepTypeField
            id="new-step-type"
            value={newType}
            onChange={changeNewType}
          />
          {/* Any step already on the checklist can be a new step's prerequisite. */}
          {steps.length > 0 && (
            <PrerequisitesField
              id="new-step-depends-on"
              options={steps}
              value={newDependsOn}
              onChange={setNewDependsOn}
            />
          )}
          <Button type="submit" variant="contained" disabled={busy}>
            Add step
          </Button>
        </Box>
        {newType === 'Choice' && (
          <OptionsEditor
            idPrefix="new-step"
            options={newOptions}
            onChange={setNewOptions}
          />
        )}
      </Box>
    </Paper>
  )
}

export default ChecklistSteps
