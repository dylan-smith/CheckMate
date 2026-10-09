import { useEffect, useRef, useState } from 'react'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Checkbox from '@mui/material/Checkbox'
import CircularProgress from '@mui/material/CircularProgress'
import Collapse from '@mui/material/Collapse'
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
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import useMediaQuery from '@mui/material/useMediaQuery'
import { TransitionGroup } from 'react-transition-group'
import { Link, useNavigate, useParams } from 'react-router'
import { describeFetchError } from '../api/checklists'
import { getRun, getRunByKey } from '../api/runs'
import type { StepType } from '../api/checklists'
import { isClientKey } from '../offline/clientKey'
import {
  applyStepUpdate,
  bump,
  fromServerRun,
  stepChangeError,
  unfinishedSteps,
  unfinishedStepsMessage,
} from '../offline/runs'
import type { RunStepUpdate } from '../offline/runs'
import { useLocalStore } from '../offline/store'
import type { LocalRun, LocalRunStep } from '../offline/store'
import { pushRun, requestSync } from '../offline/sync'
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
  format: (step: LocalRunStep) => string
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
  step: LocalRunStep
  kind: InputKind
  disabled: boolean
  showSaved: boolean
  // hasFocus says whether the field had focus when it saved, so it can get it back if the save moves the step.
  onSave: (
    update: RunStepUpdate,
    hasFocus: boolean,
  ) => Promise<LocalRunStep | null>
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
    // Unless the user has moved on to another field in the meantime, which a save on the device leaves little
    // time for, but a quick typist manages.
    if (
      focusOnMount &&
      (document.activeElement === null ||
        document.activeElement === document.body)
    ) {
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
  step: LocalRunStep
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

const notOnDeviceMessage =
  "This fill-out isn't saved on this device. Connect to the internet to load it."

const deviceSaveFailedMessage = "Couldn't save this change on this device."

// A fill-out lives on the device: every change is kept here first and sent to the API in the background
// (see src/offline/sync.ts), so it can be filled out with no connection. A fill-out the device hasn't got is
// fetched from the API once and kept from then on.
function RunView({ clientKey }: { clientKey: string }) {
  const navigate = useNavigate()
  const store = useLocalStore()
  const [run, setRun] = useState<LocalRun | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [loading, setLoading] = useState(true)
  // Counts the loads, so Retry after a failed one loads again.
  const [loadAttempt, setLoadAttempt] = useState(0)
  const [loadFailed, setLoadFailed] = useState(false)
  // Steps whose tick or picked option is still saving, so each one can only have one save in flight.
  const [savingStepIds, setSavingStepIds] = useState<ReadonlySet<number>>(
    new Set(),
  )
  const [completing, setCompleting] = useState(false)
  const [deleting, setDeleting] = useState(false)
  // The text or number step whose field had focus when it last saved, so it keeps focus if that moves the step.
  const [refocusStepId, setRefocusStepId] = useState<number | null>(null)
  // The step whose "can't be un-done" tooltip is showing.
  const [reasonStepId, setReasonStepId] = useState<number | null>(null)
  const [errorMessage, setErrorMessage] = useState('')
  // Steps slide in and out as they unlock or lock again, unless the device asks for less motion.
  const reduceMotion = useMediaQuery('(prefers-reduced-motion: reduce)')
  // Ticks still saving and each text field's saveDraft, so completing the run can wait for them first.
  const pendingTicks = useRef(new Set<Promise<LocalRunStep | null>>())
  const saveDrafts = useRef(new Map<number, SaveDraft>())
  // The run as last shown, for checks made after awaiting a save, when the render's run is out of date.
  const runRef = useRef(run)
  runRef.current = run
  // The sync engine changes the stored fill-out too (its sync state, or the API's copy after a conflict), so
  // the page reads it again after each change, once its own saves are done.
  const savesInFlight = useRef(0)
  const completingRef = useRef(false)
  const refreshPending = useRef(false)

  useEffect(() => {
    // Ignore a response that arrives after the user has left the page.
    let current = true

    async function loadRun() {
      setLoading(true)
      setLoadFailed(false)
      setErrorMessage('')
      try {
        const local = await store.getRun(clientKey)
        let loaded: LocalRun | null
        if (local !== undefined) {
          // Deleted here and waiting to be deleted from the API, so it's gone as far as the user is concerned.
          loaded = local.deletedAt === null ? local : null
        } else {
          const server = await getRunByKey(clientKey)
          loaded = server === null ? null : fromServerRun(server, now())
          if (loaded !== null) {
            // Shown even if the device can't keep it.
            await store.putRun(loaded).catch(() => undefined)
          }
        }
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
        setLoadFailed(true)
        if (error instanceof TypeError) {
          setErrorMessage(notOnDeviceMessage)
        } else {
          trackException(error, { operation: 'loadRun' })
          setErrorMessage(
            describeFetchError(error, 'Unable to load this fill-out.'),
          )
        }
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
  }, [clientKey, store, loadAttempt])

  useEffect(() => {
    return store.subscribe(() => {
      // Completing writes the fill-out as complete before the page moves on, which isn't to show in between.
      if (savesInFlight.current > 0 || completingRef.current) {
        refreshPending.current = true
      } else {
        void refreshFromStore()
      }
    })
  })

  async function refreshFromStore() {
    try {
      const local = await store.getRun(clientKey)
      if (local !== undefined && local.deletedAt === null) {
        setRun(local)
      }
    } catch {
      // The page keeps showing the run as it was.
    }
  }

  if (notFound) {
    return (
      <NotFoundPage message="That fill-out doesn't exist. Its checklist may have been deleted." />
    )
  }

  function now() {
    return new Date().toISOString()
  }

  function setStep(
    stepId: number,
    change: (step: LocalRunStep) => LocalRunStep,
  ) {
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

  // Keeps the change on the device and returns the saved step, or null when it couldn't be kept.
  async function handleSave(
    stepId: number,
    update: RunStepUpdate,
  ): Promise<LocalRunStep | null> {
    setErrorMessage('')
    const current = runRef.current
    if (current === null) {
      return null
    }

    setSavingStepIds((ids) => new Set(ids).add(stepId))
    savesInFlight.current += 1
    // Show a tick or a picked option straight away, and undo it if the save fails. A text field already
    // shows what was typed. The step can't change again while this saves, so this is what to undo to.
    const previousOptionId =
      current.steps.find((step) => step.stepId === stepId)?.selectedOptionId ??
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
    function undo() {
      if ('isDone' in update) {
        setStep(stepId, (step) => ({ ...step, isDone: !update.isDone }))
      }
      if ('optionId' in update) {
        setStep(stepId, (step) => ({
          ...step,
          selectedOptionId: previousOptionId,
        }))
      }
    }

    try {
      const at = now()
      // The page keeps the user from changes the API would refuse, so this is the last check, made on the
      // fill-out as it's kept rather than as last shown.
      const check = { problem: null as string | null }
      const saved = await store.updateRun(clientKey, (stored) => {
        check.problem = stepChangeError(stored, stepId, update)
        if (check.problem !== null) {
          return stored
        }
        return bump(
          {
            ...stored,
            steps: stored.steps.map((step) =>
              step.stepId === stepId ? applyStepUpdate(step, update, at) : step,
            ),
          },
          at,
        )
      })
      if (saved === undefined) {
        setNotFound(true)
        return null
      }
      if (check.problem !== null) {
        undo()
        setErrorMessage(check.problem)
        return null
      }
      setRun(saved)
      requestSync()
      return saved.steps.find((step) => step.stepId === stepId) ?? null
    } catch (error) {
      undo()
      trackException(error, { operation: 'saveRunStep' })
      setErrorMessage(deviceSaveFailedMessage)
      return null
    } finally {
      setSavingStepIds((ids) => {
        const next = new Set(ids)
        next.delete(stepId)
        return next
      })
      savesInFlight.current -= 1
      if (savesInFlight.current === 0 && refreshPending.current) {
        refreshPending.current = false
        void refreshFromStore()
      }
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

  // Completes the fill-out on the device and sends it straight away when it can. Offline, it's complete here
  // and reaches the API later; the API can still turn it down then, which the page shows when it's opened again.
  async function handleComplete() {
    setCompleting(true)
    completingRef.current = true
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
      // As kept, since the saves just made may not have reached the page's copy yet.
      const current = await store.getRun(clientKey)
      if (current === undefined) {
        setNotFound(true)
        return
      }
      if (unfinishedSteps(current).length > 0) {
        setErrorMessage(unfinishedStepsMessage)
        return
      }

      const at = now()
      const completed = await store.updateRun(clientKey, (stored) =>
        bump({ ...stored, completedAt: at }, at),
      )
      if (completed === undefined) {
        setNotFound(true)
        return
      }

      // The page moves on once the API has it, or once it's clear the API can't be reached, so it doesn't
      // show as complete here first.
      const outcome = await pushRun(clientKey)
      if (outcome === 'synced' || outcome === 'pending') {
        trackEvent('RunCompleted')
        // The checklists page shows the notice as a toast.
        void navigate('/', {
          state: {
            notice:
              outcome === 'synced'
                ? `Completed "${completed.checklistName}".`
                : `Completed "${completed.checklistName}". It's saved on this device and will sync when you're online.`,
          },
        })
        return
      }

      // The API said no, and the store has its answer: a message to fix, or its own completed copy.
      const latest = await store.getRun(clientKey)
      if (outcome === 'rejected') {
        setErrorMessage(
          latest?.syncError?.message ?? 'Unable to complete this fill-out.',
        )
        const reopened = await store.updateRun(clientKey, (stored) =>
          bump({ ...stored, completedAt: null }, now()),
        )
        setRun(reopened ?? latest ?? completed)
      } else if (latest !== undefined) {
        setRun(latest)
      }
    } catch (error) {
      trackException(error, { operation: 'completeRun' })
      setErrorMessage(deviceSaveFailedMessage)
    } finally {
      completingRef.current = false
      refreshPending.current = false
      setCompleting(false)
    }
  }

  // Deletes the run whether it's in progress or complete, and goes back to its checklist. The API's copy, if it
  // has one, is deleted when the device next syncs.
  async function handleDelete(checklistId: number) {
    setDeleting(true)
    setErrorMessage('')

    try {
      await store.deleteRun(clientKey)
      trackEvent('RunDeleted')
      requestSync()
      void navigate(`/checklists/${checklistId}`)
    } catch (error) {
      trackException(error, { operation: 'deleteRun' })
      setErrorMessage('Unable to delete this fill-out.')
      setDeleting(false)
    }
  }

  const isComplete = run?.completedAt != null
  const steps = run?.steps ?? []
  const doneCount = steps.filter((step) => step.isDone).length
  // Worked out from the steps as shown, so a tick unlocks the steps after it straight away.
  const doneStepIds = new Set(
    steps.filter((step) => step.isDone).map((step) => step.stepId),
  )
  // A step deleted from the checklist before it was done can't be done any more, so an open run leaves it out.
  const isOpenStep = (step: LocalRunStep) =>
    !step.isDone && step.stepId !== null
  const isLocked = (step: LocalRunStep) =>
    step.dependsOnStepIds.some((stepId) => !doneStepIds.has(stepId))
  const isToDo = (step: LocalRunStep) => isOpenStep(step) && !isLocked(step)
  const lockedCount = steps.filter(
    (step) => isOpenStep(step) && isLocked(step),
  ).length
  const stepCount = isComplete
    ? steps.length
    : steps.filter((step) => step.isDone || step.stepId !== null).length

  function renderStep(step: LocalRunStep) {
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
    // Says why in a tooltip rather than under the step, so the list doesn't move as it comes and goes. A tap shows
    // it too: the tooltip's own touch handling only opens for a disabled element, and this one wraps the whole
    // field. Every step has the tooltip, so a field isn't remounted when it turns on.
    const cantUndoReason = canUndo
      ? ''
      : `Can't be un-done while ${doneDependents.map((other) => `"${other.text}"`).join(', ')} ${doneDependents.length === 1 ? 'is' : 'are'} done.`
    return (
      <ListItem
        component="div"
        disableGutters
        sx={{ flexDirection: 'column', alignItems: 'flex-start' }}
      >
        <Tooltip
          title={cantUndoReason}
          describeChild
          placement="bottom-start"
          open={!canUndo && reasonStepId === stepId}
          onOpen={() => setReasonStepId(stepId)}
          onClose={() => setReasonStepId(null)}
        >
          <Box
            sx={{ width: '100%' }}
            onTouchStart={() => {
              if (!canUndo) {
                setReasonStepId(stepId)
              }
            }}
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
          </Box>
        </Tooltip>
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
            loadFailed && (
              <Button
                color="inherit"
                size="small"
                onClick={() => setLoadAttempt((attempt) => attempt + 1)}
              >
                Retry
              </Button>
            )
          }
        >
          {errorMessage}
        </Alert>
      )}

      {run?.syncError?.kind === 'rejected' && (
        <Alert severity="warning">
          Not synced yet: {run.syncError.message}
        </Alert>
      )}

      {run?.syncError?.kind === 'conflict' && (
        <Alert severity="info">
          This fill-out was completed on another device, so it shows what was
          saved there.
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
              <>
                {/* Steps keep their place in the checklist's order as they're done. A completed run shows every step. */}
                <List aria-label="Steps" sx={{ my: 1 }}>
                  <TransitionGroup component={null}>
                    {run.steps.map(
                      (step, index) =>
                        (isComplete || step.isDone || isToDo(step)) && (
                          <Collapse
                            key={step.stepId ?? `deleted-${index}`}
                            component="li"
                            timeout={reduceMotion ? 0 : 'auto'}
                          >
                            {renderStep(step)}
                          </Collapse>
                        ),
                    )}
                  </TransitionGroup>
                </List>
                {!isComplete && lockedCount > 0 && (
                  <Typography color="text.secondary" sx={{ mb: 1 }}>
                    {lockedCount === 1
                      ? '1 more step shows up once the steps it depends on are done.'
                      : `${lockedCount} more steps show up once the steps they depend on are done.`}
                  </Typography>
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

// Links from before fill-outs had keys name the API's id, so the fill-out is looked up and the page moves on to
// its key.
function LegacyRunRedirect({ id }: { id: number }) {
  const navigate = useNavigate()
  const [notFound, setNotFound] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')

  useEffect(() => {
    let current = true

    async function findRun() {
      try {
        const run = await getRun(id)
        if (!current) {
          return
        }
        if (run === null) {
          setNotFound(true)
        } else {
          void navigate(`/runs/${run.clientKey}`, { replace: true })
        }
      } catch (error) {
        if (current) {
          setErrorMessage(
            describeFetchError(error, 'Unable to load this fill-out.'),
          )
        }
      }
    }

    void findRun()

    return () => {
      current = false
    }
  }, [id, navigate])

  if (notFound) {
    return (
      <NotFoundPage message="That fill-out doesn't exist. Its checklist may have been deleted." />
    )
  }
  if (errorMessage) {
    return <Alert severity="error">{errorMessage}</Alert>
  }
  return (
    <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
      <CircularProgress aria-label="Loading" />
    </Box>
  )
}

function RunPage() {
  const { key } = useParams()
  // Keyed so going back or forward between two runs starts each one with fresh state.
  if (isClientKey(key)) {
    return <RunView key={key} clientKey={key} />
  }
  const id = parseId(key)
  if (id === null) {
    return <NotFoundPage />
  }
  return <LegacyRunRedirect key={id} id={id} />
}

export default RunPage
