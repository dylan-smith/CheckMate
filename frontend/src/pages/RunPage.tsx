import { useEffect, useState } from 'react'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Checkbox from '@mui/material/Checkbox'
import CircularProgress from '@mui/material/CircularProgress'
import FormControlLabel from '@mui/material/FormControlLabel'
import List from '@mui/material/List'
import ListItem from '@mui/material/ListItem'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import { Link, useParams } from 'react-router'
import { ApiError, describeFetchError } from '../api/checklists'
import { completeRun, getRun, saveRunStep } from '../api/runs'
import type { ChecklistRun, RunStep, RunStepUpdate } from '../api/runs'
import { trackEvent, trackException } from '../telemetry'
import NotFoundPage from './NotFoundPage'
import { parseId } from './parseId'

function formatDateTime(value: string) {
  return new Date(value).toLocaleString()
}

type TextStepFieldProps = {
  step: RunStep
  disabled: boolean
  saving: boolean
  onSave: (text: string) => Promise<RunStep | null>
}

// Saved when the field loses focus or Enter is pressed, and only if the text changed.
function TextStepField({ step, disabled, saving, onSave }: TextStepFieldProps) {
  const [draft, setDraft] = useState(step.responseText ?? '')

  async function save() {
    if (disabled || saving || draft.trim() === (step.responseText ?? '')) {
      return
    }
    const saved = await onSave(draft)
    // Show the value as saved, trimmed. A failed save keeps what was typed so it can be tried again.
    if (saved) {
      setDraft(saved.responseText ?? '')
    }
  }

  return (
    <Box
      component="form"
      onSubmit={(event) => {
        event.preventDefault()
        void save()
      }}
      sx={{ width: '100%' }}
    >
      <TextField
        label={step.text}
        // Once the run is read-only, show what was saved rather than anything typed since.
        value={disabled ? (step.responseText ?? '') : draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => void save()}
        disabled={disabled}
        // Read-only rather than disabled while saving, so pressing Enter doesn't lose focus.
        slotProps={{ htmlInput: { maxLength: 1000, readOnly: saving } }}
        size="small"
        fullWidth
      />
    </Box>
  )
}

function RunView({ id }: { id: number }) {
  const [run, setRun] = useState<ChecklistRun | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [loading, setLoading] = useState(true)
  // Steps whose tick is still saving, so each one can only have one save in flight.
  const [savingStepIds, setSavingStepIds] = useState<ReadonlySet<number>>(
    new Set(),
  )
  const [completing, setCompleting] = useState(false)
  // Set by a 409, before the reload that fetches the completed run, so the page can't be edited if that fails.
  const [completedElsewhere, setCompletedElsewhere] = useState(false)
  const [reloadFailed, setReloadFailed] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')

  useEffect(() => {
    // Ignore a response that arrives after the user has left the page.
    let current = true

    async function loadRun() {
      try {
        const loaded = await getRun(id)
        if (!current) {
          return
        }
        if (loaded === null) {
          setNotFound(true)
        } else {
          setRun(loaded)
        }
      } catch (error) {
        if (!current) {
          return
        }
        trackException(error, { operation: 'loadRun' })
        setErrorMessage(
          describeFetchError(error, 'Unable to load this fill-out.'),
        )
      } finally {
        if (current) {
          setLoading(false)
        }
      }
    }

    void loadRun()

    return () => {
      current = false
    }
  }, [id])

  if (notFound) {
    return (
      <NotFoundPage message="That fill-out doesn't exist. Its checklist may have been deleted." />
    )
  }

  // A 409 means the run was completed somewhere else. It's read-only from now on, even if reloading it fails.
  async function showCompletedRun(error: ApiError) {
    setCompletedElsewhere(true)
    setErrorMessage(error.message)
    await reloadCompletedRun()
  }

  async function reloadCompletedRun() {
    setReloadFailed(false)
    try {
      const loaded = await getRun(id)
      if (loaded === null) {
        setNotFound(true)
      } else {
        setRun(loaded)
      }
    } catch {
      // The run is still shown as read-only, and the error alert offers to try again.
      setReloadFailed(true)
    }
  }

  function setStep(stepId: number, change: (step: RunStep) => RunStep) {
    setRun(
      (current) =>
        current && {
          ...current,
          steps: current.steps.map((step) =>
            step.stepId === stepId ? change(step) : step,
          ),
        },
    )
  }

  // Returns the saved step, or null when the save failed.
  async function handleSave(
    stepId: number,
    update: RunStepUpdate,
  ): Promise<RunStep | null> {
    setErrorMessage('')
    setSavingStepIds((current) => new Set(current).add(stepId))
    // Show a tick straight away, and undo it if the save fails. A text field already shows what was typed.
    if ('isDone' in update) {
      setStep(stepId, (step) => ({ ...step, isDone: update.isDone }))
    }

    try {
      const saved = await saveRunStep(id, stepId, update)
      setStep(stepId, () => saved)
      return saved
    } catch (error) {
      if ('isDone' in update) {
        setStep(stepId, (step) => ({ ...step, isDone: !update.isDone }))
      }
      if (error instanceof ApiError) {
        await showCompletedRun(error)
      } else {
        trackException(error, { operation: 'saveRunStep' })
        setErrorMessage(describeFetchError(error, 'Unable to save step.'))
      }
      return null
    } finally {
      setSavingStepIds((current) => {
        const next = new Set(current)
        next.delete(stepId)
        return next
      })
    }
  }

  async function handleComplete() {
    setCompleting(true)
    setErrorMessage('')

    try {
      setRun(await completeRun(id))
      trackEvent('RunCompleted')
    } catch (error) {
      if (error instanceof ApiError) {
        await showCompletedRun(error)
      } else {
        trackException(error, { operation: 'completeRun' })
        setErrorMessage(
          describeFetchError(error, 'Unable to complete this fill-out.'),
        )
      }
    } finally {
      setCompleting(false)
    }
  }

  const isComplete = run?.completedAt != null || completedElsewhere
  const doneCount = run?.steps.filter((step) => step.isDone).length ?? 0

  return (
    <Stack spacing={2}>
      {run && (
        <Box>
          <Button component={Link} to={`/checklists/${run.checklistId}`}>
            ← Back to checklist
          </Button>
        </Box>
      )}

      {errorMessage && (
        <Alert
          severity="error"
          action={
            reloadFailed && (
              <Button
                color="inherit"
                size="small"
                onClick={() => void reloadCompletedRun()}
              >
                Reload
              </Button>
            )
          }
        >
          {errorMessage}
        </Alert>
      )}

      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
          <CircularProgress aria-label="Loading" />
        </Box>
      ) : (
        run && (
          <Paper component="section" elevation={2} sx={{ p: 3 }}>
            <Typography
              variant="h5"
              component="h2"
              sx={{ mb: 1, overflowWrap: 'anywhere' }}
            >
              {run.checklistName}
            </Typography>
            <Typography color="text.secondary">
              Started {formatDateTime(run.startedAt)}
            </Typography>
            {run.completedAt && (
              <Alert severity="success" sx={{ mt: 2 }}>
                Completed {formatDateTime(run.completedAt)}
              </Alert>
            )}

            {run.steps.length === 0 ? (
              <Typography color="text.secondary" sx={{ my: 2 }}>
                This checklist has no steps.
              </Typography>
            ) : (
              <List aria-label="Steps" sx={{ my: 1 }}>
                {run.steps.map((step, index) => {
                  const { stepId } = step
                  // A step deleted from the checklist can't be saved any more.
                  const disabled = isComplete || completing || stepId === null
                  return (
                    <ListItem key={stepId ?? `deleted-${index}`} disableGutters>
                      {step.type === 'Text' ? (
                        <TextStepField
                          step={step}
                          disabled={disabled}
                          saving={stepId !== null && savingStepIds.has(stepId)}
                          onSave={(text) =>
                            stepId === null
                              ? Promise.resolve(null)
                              : handleSave(stepId, { text })
                          }
                        />
                      ) : (
                        <FormControlLabel
                          sx={{ overflowWrap: 'anywhere' }}
                          control={
                            <Checkbox
                              checked={step.isDone}
                              disabled={disabled || savingStepIds.has(stepId)}
                              onChange={(event) => {
                                if (stepId !== null) {
                                  void handleSave(stepId, {
                                    isDone: event.target.checked,
                                  })
                                }
                              }}
                            />
                          }
                          label={step.text}
                        />
                      )}
                    </ListItem>
                  )
                })}
              </List>
            )}

            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: 1,
              }}
            >
              <Typography color="text.secondary">
                {doneCount} of {run.steps.length} done
              </Typography>
              {!isComplete && (
                <Button
                  type="button"
                  variant="contained"
                  disabled={completing || savingStepIds.size > 0}
                  onClick={() => void handleComplete()}
                >
                  {completing ? 'Completing…' : 'Complete'}
                </Button>
              )}
            </Box>
          </Paper>
        )
      )}
    </Stack>
  )
}

function RunPage() {
  const id = parseId(useParams().runId)
  if (id === null) {
    return <NotFoundPage />
  }
  // Keyed by id so going back or forward between two runs starts each one with fresh state.
  return <RunView key={id} id={id} />
}

export default RunPage
