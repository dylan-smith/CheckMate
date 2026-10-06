import { useState } from 'react'
import type { SubmitEvent } from 'react'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import List from '@mui/material/List'
import ListItem from '@mui/material/ListItem'
import ListItemText from '@mui/material/ListItemText'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import {
  createStep,
  deleteStep,
  describeFetchError,
  updateStep,
} from '../api/checklists'
import type { ChecklistStep } from '../api/checklists'
import { trackEvent, trackException } from '../telemetry'

type ChecklistStepsProps = {
  checklistId: number
  initialSteps: ChecklistStep[]
}

function ChecklistSteps({ checklistId, initialSteps }: ChecklistStepsProps) {
  const [steps, setSteps] = useState(initialSteps)
  const [newText, setNewText] = useState('')
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editText, setEditText] = useState('')
  // Only one change runs at a time, so the list can't get out of step with the API.
  const [busy, setBusy] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')

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
      const created = await createStep(checklistId, trimmedText)
      trackEvent('StepAdded')
      setSteps((current) => [...current, created])
      setNewText('')
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
      const saved = await updateStep(checklistId, stepId, trimmedText)
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

  return (
    <Paper component="section" elevation={2} sx={{ p: 3 }}>
      <Typography variant="h6" component="h3" sx={{ mb: 2 }}>
        Steps
      </Typography>

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
          {steps.map((step) => (
            <ListItem key={step.id} divider disableGutters>
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
                  <Stack direction="row" spacing={1}>
                    <Button type="submit" variant="contained" disabled={busy}>
                      Save
                    </Button>
                    <Button
                      type="button"
                      disabled={busy}
                      onClick={() => setEditingId(null)}
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
                  <ListItemText
                    primary={step.text}
                    sx={{ overflowWrap: 'anywhere' }}
                  />
                  <Stack direction="row" spacing={1}>
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
        <Button type="submit" variant="contained" disabled={busy}>
          Add step
        </Button>
      </Box>
    </Paper>
  )
}

export default ChecklistSteps
