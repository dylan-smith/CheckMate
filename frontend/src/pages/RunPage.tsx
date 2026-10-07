import { useEffect, useRef, useState } from 'react'
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
import { Link, useNavigate, useParams } from 'react-router'
import { ApiError, describeFetchError } from '../api/checklists'
import { completeRun, getRun, saveRunStep } from '../api/runs'
import type { StepType } from '../api/checklists'
import type { ChecklistRun, RunStep, RunStepUpdate } from '../api/runs'
import { trackEvent, trackException } from '../telemetry'
import NotFoundPage from './NotFoundPage'
import { formatDateTime } from './formatDateTime'
import { parseId } from './parseId'

// A draft that can be saved, as the field shows it once saved and as it's sent, or why it can't be saved.
type ParsedDraft = { value: string; update: RunStepUpdate } | { error: string }

// How a step that takes a typed value shows, checks and sends it.
type InputKind = {
  inputMode: 'text' | 'decimal'
  maxLength: number
  format: (step: RunStep) => string
  parse: (draft: string) => ParsedDraft
}

// Matches the API, which keeps numbers with up to 9 digits before the decimal point and 6 after it. That's
// 15 significant digits, which a JavaScript number holds exactly, so sending it as a number can't round it.
const numberPattern = /^[-+]?(\d+\.?\d*|\.\d+)$/

function parseNumber(draft: string): ParsedDraft {
  const trimmed = draft.trim()
  if (trimmed === '') {
    return { value: '', update: { number: null } }
  }
  if (!numberPattern.test(trimmed)) {
    return { error: 'Enter a number, like 12 or -3.5.' }
  }
  const [whole, fraction = ''] = trimmed.replace(/^[-+]/, '').split('.')
  if (
    whole.replace(/^0+/, '').length > 9 ||
    fraction.replace(/0+$/, '').length > 6
  ) {
    return {
      error: 'Use at most 9 digits before the decimal point and 6 after it.',
    }
  }
  const number = Number(trimmed)
  return { value: String(number), update: { number } }
}

const inputKinds: Partial<Record<StepType, InputKind>> = {
  Text: {
    inputMode: 'text',
    maxLength: 1000,
    format: (step) => step.responseText ?? '',
    parse: (draft) => ({ value: draft.trim(), update: { text: draft } }),
  },
  Number: {
    inputMode: 'decimal',
    maxLength: 30,
    format: (step) =>
      step.responseNumber === null ? '' : String(step.responseNumber),
    parse: parseNumber,
  },
}

// Saves whatever was typed but isn't saved yet, and resolves to whether it all is saved now.
type SaveDraft = () => Promise<boolean>

type InputStepFieldProps = {
  step: RunStep
  kind: InputKind
  disabled: boolean
  showSaved: boolean
  onSave: (update: RunStepUpdate) => Promise<RunStep | null>
  // Lets completing the run save this field first.
  registerSaveDraft: (saveDraft: SaveDraft | null) => void
}

// Saved when the field loses focus or Enter is pressed, and only if the value changed.
function InputStepField({
  step,
  kind,
  disabled,
  showSaved,
  onSave,
  registerSaveDraft,
}: InputStepFieldProps) {
  const [draft, setDraft] = useState(() => kind.format(step))
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  // Kept in refs as well, since completing the run can call saveDraft after awaiting other saves, and
  // by then the values from the render that created it are out of date.
  const draftRef = useRef(draft)
  const savedRef = useRef(draft)
  const inFlightRef = useRef<Promise<boolean> | null>(null)

  async function saveDraft(): Promise<boolean> {
    // One save at a time: wait for the one under way, then check again whether there's more to save.
    while (inFlightRef.current) {
      await inFlightRef.current
    }
    const parsed = kind.parse(draftRef.current)
    if ('error' in parsed) {
      setError(parsed.error)
      return false
    }
    setError('')
    if (parsed.value === savedRef.current) {
      return true
    }

    const request = (async () => {
      setSaving(true)
      try {
        const saved = await onSave(parsed.update)
        if (!saved) {
          // Keep what was typed so it can be tried again.
          return false
        }
        // Show the value as saved, such as trimmed. The field is read-only while saving, so nothing was typed since.
        savedRef.current = kind.format(saved)
        draftRef.current = savedRef.current
        setDraft(savedRef.current)
        return true
      } finally {
        setSaving(false)
      }
    })()
    inFlightRef.current = request
    try {
      return await request
    } finally {
      inFlightRef.current = null
    }
  }

  useEffect(() => {
    registerSaveDraft(saveDraft)
    return () => registerSaveDraft(null)
  })

  function saveIfEnabled() {
    if (!disabled) {
      void saveDraft()
    }
  }

  return (
    <Box
      component="form"
      onSubmit={(event) => {
        event.preventDefault()
        saveIfEnabled()
      }}
      sx={{ width: '100%' }}
    >
      <TextField
        label={step.text}
        // Once the run is complete, show what was saved.
        value={showSaved ? kind.format(step) : draft}
        onChange={(event) => {
          draftRef.current = event.target.value
          setDraft(event.target.value)
        }}
        onBlur={saveIfEnabled}
        disabled={disabled}
        error={error !== '' && !disabled}
        // While editing, why the value can't be saved. Once the run is complete, when the step was done.
        helperText={
          disabled
            ? showSaved && step.completedAt
              ? `Done ${formatDateTime(step.completedAt)}`
              : undefined
            : error || undefined
        }
        // Read-only rather than disabled while saving, so pressing Enter doesn't lose focus.
        slotProps={{
          htmlInput: {
            inputMode: kind.inputMode,
            maxLength: kind.maxLength,
            readOnly: saving,
          },
        }}
        size="small"
        fullWidth
      />
    </Box>
  )
}

function RunView({ id }: { id: number }) {
  const navigate = useNavigate()
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
  // Ticks still saving and each text field's saveDraft, so completing the run can wait for them first.
  const pendingTicks = useRef(new Set<Promise<RunStep | null>>())
  const saveDrafts = useRef(new Map<number, SaveDraft>())

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

  function handleToggle(stepId: number, isDone: boolean) {
    const tick = handleSave(stepId, { isDone })
    pendingTicks.current.add(tick)
    void tick.finally(() => pendingTicks.current.delete(tick))
  }

  async function handleComplete() {
    setCompleting(true)
    setErrorMessage('')

    try {
      // Let ticks finish saving and save any value typed since, so completing can't drop a change. A failed
      // save already shows its error, and the run stays open so it can be tried again.
      const ticks = await Promise.all(pendingTicks.current)
      if (ticks.includes(null)) {
        // Stop before saving typed values, since a successful save of one would clear the tick's error.
        return
      }
      const drafts = await Promise.all(
        [...saveDrafts.current.values()].map((saveDraft) => saveDraft()),
      )
      if (drafts.includes(false)) {
        return
      }
      const completed = await completeRun(id)
      trackEvent('RunCompleted')
      // The checklists page shows the notice as a toast.
      void navigate('/', {
        state: { notice: `Completed "${completed.checklistName}".` },
      })
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
                  const kind = inputKinds[step.type]
                  return (
                    <ListItem key={stepId ?? `deleted-${index}`} disableGutters>
                      {kind ? (
                        <InputStepField
                          step={step}
                          kind={kind}
                          disabled={disabled}
                          showSaved={isComplete}
                          onSave={(update) =>
                            stepId === null
                              ? Promise.resolve(null)
                              : handleSave(stepId, update)
                          }
                          registerSaveDraft={(saveDraft) => {
                            if (stepId === null) {
                              return
                            }
                            if (saveDraft) {
                              saveDrafts.current.set(stepId, saveDraft)
                            } else {
                              saveDrafts.current.delete(stepId)
                            }
                          }}
                        />
                      ) : (
                        <Box>
                          <FormControlLabel
                            sx={{ overflowWrap: 'anywhere' }}
                            control={
                              <Checkbox
                                checked={step.isDone}
                                disabled={disabled || savingStepIds.has(stepId)}
                                onChange={(event) => {
                                  if (stepId !== null) {
                                    handleToggle(stepId, event.target.checked)
                                  }
                                }}
                              />
                            }
                            label={step.text}
                          />
                          {/* A completed run is read-only, so it shows when each step was done. */}
                          {isComplete && step.completedAt && (
                            // Styled like a text step's helper text, which is greyed out with the field.
                            <Typography
                              variant="caption"
                              sx={{
                                display: 'block',
                                ml: 4,
                                color: 'text.disabled',
                              }}
                            >
                              Done {formatDateTime(step.completedAt)}
                            </Typography>
                          )}
                        </Box>
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
                  // Not disabled while steps save: completing waits for those saves itself.
                  disabled={completing}
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
