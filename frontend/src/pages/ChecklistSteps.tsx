import { useEffect, useRef, useState } from 'react'
import type { SubmitEvent } from 'react'
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

function ChecklistSteps({ checklistId, initialSteps }: ChecklistStepsProps) {
  const [steps, setSteps] = useState(initialSteps)
  const [newText, setNewText] = useState('')
  const [newType, setNewType] = useState<StepType>('Checkbox')
  const [newOptions, setNewOptions] = useState<OptionDraft[]>([])
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editText, setEditText] = useState('')
  const [editType, setEditType] = useState<StepType>('Checkbox')
  const [editOptions, setEditOptions] = useState<OptionDraft[]>([])
  // Only one change runs at a time, so the list can't get out of step with the API.
  const [busy, setBusy] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  // Read out by screen readers, since a moved step otherwise changes place silently.
  const [moveAnnouncement, setMoveAnnouncement] = useState('')
  // The move buttons are disabled while a move saves, which drops keyboard focus, so it's put back here.
  const focusAfterMove = useRef<{
    stepId: number
    direction: MoveDirection
  } | null>(null)

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
      const created = await createStep(
        checklistId,
        trimmedText,
        newType,
        options,
      )
      trackEvent('StepAdded')
      setSteps((current) => [...current, created])
      setNewText('')
      setNewType('Checkbox')
      setNewOptions([])
    } catch (error) {
      trackException(error, { operation: 'addStep' })
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
      const saved = await updateStep(
        checklistId,
        stepId,
        trimmedText,
        editType,
        options,
      )
      trackEvent('StepUpdated')
      setSteps((current) =>
        current.map((step) => (step.id === saved.id ? saved : step)),
      )
      setEditingId(null)
    } catch (error) {
      trackException(error, { operation: 'updateStep' })
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
      setSteps((current) => current.filter((step) => step.id !== stepId))
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

  async function handleMove(index: number, direction: MoveDirection) {
    const targetIndex = direction === 'up' ? index - 1 : index + 1
    const reordered = [...steps]
    ;[reordered[index], reordered[targetIndex]] = [
      reordered[targetIndex],
      reordered[index],
    ]
    const moved = steps[index]

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
      // Steps changed elsewhere are the user's to reload, not a failure to report.
      if (!(error instanceof ApiError)) {
        trackException(error, { operation: 'reorderSteps' })
      }
      setErrorMessage(describeFetchError(error, 'Unable to reorder steps.'))
    } finally {
      focusAfterMove.current = { stepId: moved.id, direction }
      setBusy(false)
    }
  }

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
        <List disablePadding sx={{ mb: 2 }}>
          {steps.map((step, index) => (
            <ListItem key={step.id} divider disableGutters>
              {editingId === step.id ? (
                <Box
                  component="form"
                  onSubmit={(event) => void handleUpdate(event, step.id)}
                  sx={{ display: 'grid', gap: 1, width: '100%' }}
                >
                  <Box
                    sx={{
                      display: 'flex',
                      flexDirection: { xs: 'column', sm: 'row' },
                      gap: 1,
                    }}
                  >
                    <TextField
                      id={`step-${step.id}-text`}
                      label="Step text"
                      value={editText}
                      onChange={(event) => setEditText(event.target.value)}
                      slotProps={{ htmlInput: { maxLength: 500 } }}
                      required
                      size="small"
                      sx={{ flexGrow: 1 }}
                    />
                    <StepTypeField
                      id={`step-${step.id}-type`}
                      value={editType}
                      onChange={changeEditType}
                    />
                    <Stack direction="row" spacing={1}>
                      <Button type="submit" variant="contained" disabled={busy}>
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
                <Box
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1,
                    width: '100%',
                  }}
                >
                  <ListItemText
                    primary={step.text}
                    // Checkbox is the usual type, so only the others are called out.
                    secondary={
                      step.type === 'Checkbox'
                        ? undefined
                        : step.type === 'Choice'
                          ? `${stepTypeLabels.Choice}: ${step.options.map((option) => option.text).join(', ')}`
                          : stepTypeLabels[step.type]
                    }
                    sx={{ overflowWrap: 'anywhere' }}
                  />
                  <Stack direction="row" spacing={1}>
                    <IconButton
                      id={moveButtonId(step.id, 'up')}
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
                      id={moveButtonId(step.id, 'down')}
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
              )}
            </ListItem>
          ))}
        </List>
      )}

      <Box
        component="form"
        onSubmit={(event) => void handleAdd(event)}
        sx={{ display: 'grid', gap: 1 }}
      >
        <Box
          sx={{
            display: 'flex',
            flexDirection: { xs: 'column', sm: 'row' },
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
            sx={{ flexGrow: 1 }}
          />
          <StepTypeField
            id="new-step-type"
            value={newType}
            onChange={changeNewType}
          />
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
