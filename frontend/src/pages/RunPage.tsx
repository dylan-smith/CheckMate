import { useEffect, useRef, useState } from 'react'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Checkbox from '@mui/material/Checkbox'
import CircularProgress from '@mui/material/CircularProgress'
import FormControl from '@mui/material/FormControl'
import FormControlLabel from '@mui/material/FormControlLabel'
import FormHelperText from '@mui/material/FormHelperText'
import FormLabel from '@mui/material/FormLabel'
import List from '@mui/material/List'
import ListItem from '@mui/material/ListItem'
import MenuItem from '@mui/material/MenuItem'
import Paper from '@mui/material/Paper'
import Radio from '@mui/material/Radio'
import RadioGroup from '@mui/material/RadioGroup'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import { Link, useNavigate, useParams } from 'react-router'
import { ApiError, describeFetchError } from '../api/checklists'
import { completeRun, deleteRun, getRun, saveRunStep } from '../api/runs'
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
  // hasFocus says whether the field had focus when it saved, so it can get it back if the save moves the step.
  onSave: (update: RunStepUpdate, hasFocus: boolean) => Promise<RunStep | null>
  // Lets completing the run save this field first.
  registerSaveDraft: (saveDraft: SaveDraft | null) => void
  // Set when a save moved the step to the other section while it had focus, which mounts the field again.
  focusOnMount: boolean
}

// Saved when the field loses focus or Enter is pressed, and only if the value changed.
function InputStepField({
  step,
  kind,
  disabled,
  showSaved,
  onSave,
  registerSaveDraft,
  focusOnMount,
}: InputStepFieldProps) {
  const [draft, setDraft] = useState(() => kind.format(step))
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (focusOnMount) {
      inputRef.current?.focus()
    }
  }, [focusOnMount])
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
        const saved = await onSave(
          parsed.update,
          inputRef.current === document.activeElement,
        )
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
        inputRef={inputRef}
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
        helperText={disabled ? undefined : error || undefined}
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

// More options than this show as a dropdown rather than a radio group.
const maxRadioOptions = 5

type ChoiceStepFieldProps = {
  step: RunStep
  disabled: boolean
  // Once the run is complete, or the step is deleted, it shows what was picked rather than the options.
  showSaved: boolean
  // False while a done step depends on this one, so another option can be picked but the pick can't be cleared.
  canClear: boolean
  onPick: (optionId: number | null) => void
}

function ChoiceStepField({
  step,
  disabled,
  showSaved,
  canClear,
  onPick,
}: ChoiceStepFieldProps) {
  // The picked option was removed from the step since, so say what it was.
  const removedPick =
    step.selectedOptionId === null && step.selectedOptionText !== null
      ? `"${step.selectedOptionText}" was picked, but it's no longer an option.`
      : undefined

  // A step with no options left can still have a removed pick to clear, so it only shows as read-only without one.
  if (showSaved || (step.options.length === 0 && !removedPick)) {
    return (
      <TextField
        label={step.text}
        value={step.selectedOptionText ?? ''}
        disabled
        size="small"
        fullWidth
      />
    )
  }

  const value =
    step.selectedOptionId === null ? '' : String(step.selectedOptionId)

  function pick(optionValue: string) {
    onPick(optionValue === '' ? null : Number(optionValue))
  }

  // A removed pick still counts as done, so it can be cleared too.
  const clearButton = (
    <Box>
      <Button
        type="button"
        size="small"
        disabled={disabled || !canClear}
        aria-label={`Clear "${step.text}"`}
        onClick={() => onPick(null)}
      >
        Clear
      </Button>
    </Box>
  )

  if (step.options.length > maxRadioOptions) {
    return (
      <Box sx={{ width: '100%' }}>
        <TextField
          select
          label={step.text}
          value={value}
          onChange={(event) => pick(event.target.value)}
          disabled={disabled}
          helperText={removedPick}
          size="small"
          fullWidth
        >
          <MenuItem value="" disabled={!canClear}>
            <em>None</em>
          </MenuItem>
          {step.options.map((option) => (
            <MenuItem key={option.id} value={String(option.id)}>
              {option.text}
            </MenuItem>
          ))}
        </TextField>
        {/* "None" clears a pick, but it's already shown for a removed one, so picking it does nothing. */}
        {removedPick && clearButton}
      </Box>
    )
  }

  return (
    <FormControl component="fieldset" disabled={disabled}>
      <FormLabel component="legend" sx={{ overflowWrap: 'anywhere' }}>
        {step.text}
      </FormLabel>
      <RadioGroup value={value} onChange={(event) => pick(event.target.value)}>
        {step.options.map((option) => (
          <FormControlLabel
            key={option.id}
            value={String(option.id)}
            control={<Radio />}
            label={option.text}
            sx={{ overflowWrap: 'anywhere' }}
          />
        ))}
      </RadioGroup>
      {removedPick && <FormHelperText>{removedPick}</FormHelperText>}
      {(value !== '' || removedPick) && clearButton}
    </FormControl>
  )
}

function RunView({ id }: { id: number }) {
  const navigate = useNavigate()
  const [run, setRun] = useState<ChecklistRun | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [loading, setLoading] = useState(true)
  // Steps whose tick or picked option is still saving, so each one can only have one save in flight.
  const [savingStepIds, setSavingStepIds] = useState<ReadonlySet<number>>(
    new Set(),
  )
  const [completing, setCompleting] = useState(false)
  const [deleting, setDeleting] = useState(false)
  // The text or number step whose field had focus when it last saved, so it keeps focus if that moves the step.
  const [refocusStepId, setRefocusStepId] = useState<number | null>(null)
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

  // A 400 means the change isn't allowed yet, such as a step whose prerequisites were un-done in another tab. Show
  // why, and fetch the run again so it shows which steps can be filled in now.
  async function showRejectedChange(error: ApiError) {
    setErrorMessage(error.message)
    try {
      const loaded = await getRun(id)
      if (loaded === null) {
        setNotFound(true)
      } else {
        setRun(loaded)
      }
    } catch {
      // The error already shown explains what went wrong, so keep showing the run as it was.
    }
  }

  // Sends a 409 to showCompletedRun and a 400 to showRejectedChange, and reports whether it was either.
  async function showApiError(error: unknown) {
    if (!(error instanceof ApiError)) {
      return false
    }
    if (error.status === 409) {
      await showCompletedRun(error)
    } else {
      await showRejectedChange(error)
    }
    return true
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
    // Show a tick or a picked option straight away, and undo it if the save fails. A text field already
    // shows what was typed. The step can't change again while this saves, so this is what to undo to.
    const previousOptionId =
      run?.steps.find((step) => step.stepId === stepId)?.selectedOptionId ??
      null
    if ('isDone' in update) {
      setStep(stepId, (step) => ({ ...step, isDone: update.isDone }))
    }
    if ('optionId' in update) {
      setStep(stepId, (step) => ({
        ...step,
        selectedOptionId: update.optionId,
      }))
    }

    try {
      const saved = await saveRunStep(id, stepId, update)
      setStep(stepId, () => saved)
      return saved
    } catch (error) {
      if ('isDone' in update) {
        setStep(stepId, (step) => ({ ...step, isDone: !update.isDone }))
      }
      if ('optionId' in update) {
        setStep(stepId, (step) => ({
          ...step,
          selectedOptionId: previousOptionId,
        }))
      }
      if (!(await showApiError(error))) {
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

  // Saves a tick or a picked option straight away.
  function handleToggle(stepId: number, update: RunStepUpdate) {
    // Focus is on this control now, so a field mounted again later mustn't take it.
    setRefocusStepId(null)
    const tick = handleSave(stepId, update)
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
      if (!(await showApiError(error))) {
        trackException(error, { operation: 'completeRun' })
        setErrorMessage(
          describeFetchError(error, 'Unable to complete this fill-out.'),
        )
      }
    } finally {
      setCompleting(false)
    }
  }

  // Deletes the run whether it's in progress or complete, and goes back to its checklist.
  async function handleDelete(checklistId: number) {
    setDeleting(true)
    setErrorMessage('')

    try {
      await deleteRun(id)
      trackEvent('RunDeleted')
      void navigate(`/checklists/${checklistId}`)
    } catch (error) {
      trackException(error, { operation: 'deleteRun' })
      setErrorMessage(
        describeFetchError(error, 'Unable to delete this fill-out.'),
      )
      setDeleting(false)
    }
  }

  const isComplete = run?.completedAt != null || completedElsewhere
  const steps = run?.steps ?? []
  const doneCount = steps.filter((step) => step.isDone).length
  // Worked out from the steps as shown, rather than each step's isLocked, so a tick unlocks the steps after it
  // straight away.
  const doneStepIds = new Set(
    steps.filter((step) => step.isDone).map((step) => step.stepId),
  )
  // A step deleted from the checklist before it was done can't be done any more, so an open run leaves it out.
  const isOpenStep = (step: RunStep) => !step.isDone && step.stepId !== null
  const isLocked = (step: RunStep) =>
    step.dependsOnStepIds.some((stepId) => !doneStepIds.has(stepId))
  const isToDo = (step: RunStep) => isOpenStep(step) && !isLocked(step)
  const toDoCount = steps.filter(isToDo).length
  const lockedCount = steps.filter(
    (step) => isOpenStep(step) && isLocked(step),
  ).length
  const stepCount = isComplete
    ? steps.length
    : steps.filter((step) => step.isDone || step.stepId !== null).length

  function renderStep(step: RunStep, index: number) {
    const { stepId } = step
    // A step deleted from the checklist can't be saved any more.
    const disabled = isComplete || completing || deleting || stepId === null
    const kind = inputKinds[step.type]
    // A done step can't be un-done while a done step depends on it, so those steps are un-done first.
    const doneDependents =
      isComplete || !step.isDone
        ? []
        : steps.filter(
            (other) =>
              other.isDone &&
              stepId !== null &&
              other.dependsOnStepIds.includes(stepId),
          )
    const canUndo = doneDependents.length === 0
    return (
      <ListItem
        key={stepId ?? `deleted-${index}`}
        disableGutters
        sx={{ flexDirection: 'column', alignItems: 'flex-start' }}
      >
        {step.type === 'Choice' ? (
          <ChoiceStepField
            step={step}
            disabled={
              disabled || (stepId !== null && savingStepIds.has(stepId))
            }
            showSaved={isComplete || stepId === null}
            canClear={canUndo}
            onPick={(optionId) => {
              if (stepId !== null) {
                handleToggle(stepId, { optionId })
              }
            }}
          />
        ) : kind ? (
          <InputStepField
            step={step}
            kind={kind}
            disabled={disabled}
            showSaved={isComplete}
            onSave={(update, hasFocus) => {
              if (stepId === null) {
                return Promise.resolve(null)
              }
              setRefocusStepId(hasFocus ? stepId : null)
              return handleSave(stepId, update)
            }}
            focusOnMount={refocusStepId === stepId}
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
          <FormControlLabel
            sx={{ overflowWrap: 'anywhere' }}
            control={
              <Checkbox
                checked={step.isDone}
                disabled={
                  disabled ||
                  savingStepIds.has(stepId) ||
                  (step.isDone && !canUndo)
                }
                onChange={(event) => {
                  if (stepId !== null) {
                    handleToggle(stepId, {
                      isDone: event.target.checked,
                    })
                  }
                }}
              />
            }
            label={step.text}
          />
        )}
        {!canUndo && (
          <Typography
            variant="body2"
            color="text.secondary"
            sx={{ overflowWrap: 'anywhere' }}
          >
            Can&apos;t be un-done while{' '}
            {doneDependents.map((other) => `"${other.text}"`).join(', ')}{' '}
            {doneDependents.length === 1 ? 'is' : 'are'} done.
          </Typography>
        )}
      </ListItem>
    )
  }

  return (
    <Stack spacing={2}>
      {run && (
        <Box>
          <Button component={Link} to="/">
            ← Back to checklists
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
            ) : isComplete ? (
              // A completed run is a record of what was done, so it shows every step in the checklist's order.
              <List aria-label="Steps" sx={{ my: 1 }}>
                {run.steps.map(renderStep)}
              </List>
            ) : (
              <>
                <Typography variant="h6" component="h3" sx={{ mt: 2 }}>
                  To do
                </Typography>
                {toDoCount > 0 ? (
                  <List aria-label="To do" sx={{ my: 1 }}>
                    {run.steps.map(
                      (step, index) => isToDo(step) && renderStep(step, index),
                    )}
                  </List>
                ) : (
                  // There's always a step to do while one isn't done, since prerequisites can't form a cycle.
                  <Typography color="text.secondary" sx={{ my: 1 }}>
                    Every step is done.
                  </Typography>
                )}
                {lockedCount > 0 && (
                  <Typography color="text.secondary" sx={{ mb: 1 }}>
                    {lockedCount === 1
                      ? '1 more step shows up once the steps it depends on are done.'
                      : `${lockedCount} more steps show up once the steps they depend on are done.`}
                  </Typography>
                )}
                {doneCount > 0 && (
                  <>
                    <Typography variant="h6" component="h3" sx={{ mt: 2 }}>
                      Completed
                    </Typography>
                    <List aria-label="Completed" sx={{ my: 1 }}>
                      {run.steps.map(
                        (step, index) => step.isDone && renderStep(step, index),
                      )}
                    </List>
                  </>
                )}
              </>
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
                {doneCount} of {stepCount} done
              </Typography>
              <Stack direction="row" spacing={1}>
                <Button
                  type="button"
                  color="error"
                  variant="outlined"
                  disabled={completing || deleting}
                  aria-label="Delete fill-out"
                  onClick={() => void handleDelete(run.checklistId)}
                >
                  {deleting ? 'Deleting…' : 'Delete'}
                </Button>
                {!isComplete && (
                  <Button
                    type="button"
                    variant="contained"
                    // Not disabled while steps save: completing waits for those saves itself.
                    disabled={completing || deleting}
                    onClick={() => void handleComplete()}
                  >
                    {completing ? 'Completing…' : 'Complete'}
                  </Button>
                )}
              </Stack>
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
