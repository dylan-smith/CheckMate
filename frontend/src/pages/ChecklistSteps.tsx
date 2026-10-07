import { useEffect, useRef, useState } from 'react'
import type { DragEvent, SubmitEvent } from 'react'
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
import type { ChecklistStep, StepType } from '../api/checklists'
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

function ChecklistSteps({ checklistId, initialSteps }: ChecklistStepsProps) {
  const [steps, setSteps] = useState(initialSteps)
  const [newText, setNewText] = useState('')
  const [newType, setNewType] = useState<StepType>('Checkbox')
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editText, setEditText] = useState('')
  const [editType, setEditType] = useState<StepType>('Checkbox')
  // Only one change runs at a time, so the list can't get out of step with the API.
  const [busy, setBusy] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  // Read out by screen readers, since a moved step otherwise changes place silently.
  const [moveAnnouncement, setMoveAnnouncement] = useState('')
  const [draggingId, setDraggingId] = useState<number | null>(null)
  // Where the dragged step would go, counted as a gap between steps (0 is above the first).
  const [dropIndex, setDropIndex] = useState<number | null>(null)
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

  async function handleAdd(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()

    const trimmedText = newText.trim()
    if (!trimmedText) {
      setErrorMessage('Step text is required.')
      return
    }

    setBusy(true)
    setErrorMessage('')

    try {
      const created = await createStep(checklistId, trimmedText, newType)
      trackEvent('StepAdded')
      setSteps((current) => [...current, created])
      setNewText('')
      setNewType('Checkbox')
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

    setBusy(true)
    setErrorMessage('')

    try {
      const saved = await updateStep(checklistId, stepId, trimmedText, editType)
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

  // The direction is set for the move buttons, so keyboard focus can be put back on the step.
  async function moveStep(
    index: number,
    targetIndex: number,
    direction?: MoveDirection,
  ) {
    const reordered = [...steps]
    const [moved] = reordered.splice(index, 1)
    reordered.splice(targetIndex, 0, moved)

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

  function handleDragStart(event: DragEvent<HTMLElement>, stepId: number) {
    const row = event.currentTarget.closest('li')
    event.dataTransfer.effectAllowed = 'move'
    // Firefox only starts a drag when it carries some data.
    event.dataTransfer.setData('text/plain', String(stepId))
    if (row) {
      event.dataTransfer.setDragImage(row, 0, 0)
    }
    setDraggingId(stepId)
  }

  // The gap the pointer is nearest: above the step it's over, or below it.
  function gapAt(event: DragEvent<HTMLElement>, index: number) {
    const rect = event.currentTarget.getBoundingClientRect()
    return event.clientY < rect.top + rect.height / 2 ? index : index + 1
  }

  function handleDragOver(event: DragEvent<HTMLElement>, index: number) {
    // Only steps dragged from this list can be dropped on it, not files or text.
    if (draggingId === null) {
      return
    }
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    setDropIndex(gapAt(event, index))
  }

  function endDrag() {
    setDraggingId(null)
    setDropIndex(null)
  }

  function handleDrop(event: DragEvent<HTMLElement>, index: number) {
    const draggedIndex = steps.findIndex((step) => step.id === draggingId)
    if (draggedIndex === -1) {
      return
    }
    event.preventDefault()
    const gap = gapAt(event, index)
    endDrag()
    // The gap counts the dragged step, which is taken out before it goes back in.
    const targetIndex = gap > draggedIndex ? gap - 1 : gap
    if (targetIndex !== draggedIndex) {
      void moveStep(draggedIndex, targetIndex)
    }
  }

  // Shows where a dragged step will land, unless dropping it there wouldn't move it.
  function dropIndicator(index: number): 'top' | 'bottom' | null {
    const draggedIndex = steps.findIndex((step) => step.id === draggingId)
    if (
      draggedIndex === -1 ||
      dropIndex === null ||
      dropIndex === draggedIndex ||
      dropIndex === draggedIndex + 1
    ) {
      return null
    }
    if (dropIndex === index) {
      return 'top'
    }
    if (dropIndex === steps.length && index === steps.length - 1) {
      return 'bottom'
    }
    return null
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
        <List
          disablePadding
          sx={{ mb: 2 }}
          onDragLeave={(event) => {
            // Leaving one step for the next fires too, so only clear the indicator on leaving the list.
            if (
              !(event.relatedTarget instanceof Node) ||
              !event.currentTarget.contains(event.relatedTarget)
            ) {
              setDropIndex(null)
            }
          }}
        >
          {steps.map((step, index) => (
            <ListItem
              key={step.id}
              divider
              disableGutters
              onDragOver={(event) => handleDragOver(event, index)}
              onDrop={(event) => handleDrop(event, index)}
              sx={(theme) => {
                const indicator = dropIndicator(index)
                const color = theme.palette.primary.main
                return {
                  opacity: draggingId === step.id ? 0.5 : 1,
                  boxShadow:
                    indicator === 'top'
                      ? `inset 0 3px 0 ${color}`
                      : indicator === 'bottom'
                        ? `inset 0 -3px 0 ${color}`
                        : 'none',
                }
              }}
            >
              {editingId === step.id ? (
                <Box
                  component="form"
                  onSubmit={(event) => void handleUpdate(event, step.id)}
                  sx={{
                    display: 'flex',
                    flexDirection: { xs: 'column', sm: 'row' },
                    gap: 1,
                    width: '100%',
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
                    onChange={setEditType}
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
              ) : (
                <Box
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1,
                    width: '100%',
                  }}
                >
                  {/* Keyboard and screen reader users reorder with the move buttons instead. */}
                  <Box
                    component="span"
                    aria-hidden="true"
                    title={`Drag to reorder step "${step.text}"`}
                    draggable={!busy}
                    onDragStart={(event) => handleDragStart(event, step.id)}
                    onDragEnd={endDrag}
                    sx={{
                      px: 0.5,
                      color: 'text.secondary',
                      cursor: busy ? 'default' : 'grab',
                      userSelect: 'none',
                      fontSize: '1.25rem',
                      lineHeight: 1,
                      // Drawn by CSS so the glyph isn't part of the step's text.
                      '&::before': { content: '"⠿"' },
                    }}
                  />
                  <ListItemText
                    primary={step.text}
                    // Checkbox is the usual type, so only the others are called out.
                    secondary={
                      step.type === 'Checkbox'
                        ? undefined
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
          onChange={setNewType}
        />
        <Button type="submit" variant="contained" disabled={busy}>
          Add step
        </Button>
      </Box>
    </Paper>
  )
}

export default ChecklistSteps
