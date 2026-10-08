import { useEffect, useState } from 'react'
import type { SubmitEvent } from 'react'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import { Link, useNavigate, useParams } from 'react-router'
import {
  ApiError,
  deleteChecklist,
  describeFetchError,
  updateChecklist,
} from '../api/checklists'
import type { ChecklistDetail as ChecklistDetailData } from '../api/checklists'
import { loadChecklist } from '../offline/checklists'
import { newClientKey } from '../offline/clientKey'
import { useOnline } from '../offline/online'
import { createLocalRun } from '../offline/runs'
import { useLocalStore } from '../offline/store'
import { requestSync } from '../offline/sync'
import { trackEvent, trackException } from '../telemetry'
import ChecklistRuns from './ChecklistRuns'
import ChecklistSteps from './ChecklistSteps'
import { cachedCopyMessage, offlineMessage } from './ChecklistsPage'
import NotFoundPage from './NotFoundPage'
import { parseId } from './parseId'

function ChecklistDetail({ id }: { id: number }) {
  const navigate = useNavigate()
  const online = useOnline()
  const store = useLocalStore()
  const [checklist, setChecklist] = useState<ChecklistDetailData | null>(null)
  const [fromCache, setFromCache] = useState(false)
  const [notFound, setNotFound] = useState(false)
  const [name, setName] = useState('')
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [starting, setStarting] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')

  useEffect(() => {
    // Ignore a response that arrives after the user has left the page.
    let current = true

    async function load() {
      try {
        const loaded = await loadChecklist(id)
        if (!current) {
          return
        }
        if (loaded === null) {
          setNotFound(true)
        } else {
          setChecklist(loaded.data)
          setFromCache(loaded.fromCache)
          setName(loaded.data.name)
        }
      } catch (error) {
        if (!current) {
          return
        }
        trackException(error, { operation: 'load' })
        setErrorMessage(describeFetchError(error, 'Unable to load checklist.'))
      } finally {
        if (current) {
          setLoading(false)
        }
      }
    }

    void load()

    return () => {
      current = false
    }
  }, [id])

  if (notFound) {
    return (
      <NotFoundPage message="That checklist doesn't exist. It may have been deleted." />
    )
  }

  async function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()

    const trimmedName = name.trim()
    if (!trimmedName) {
      setErrorMessage('Checklist name is required.')
      return
    }

    setSubmitting(true)
    setErrorMessage('')

    try {
      const saved = await updateChecklist(id, trimmedName)
      trackEvent('ChecklistUpdated')
      // The response has no steps, and the steps section keeps its own, so only take the name.
      setChecklist((current) => current && { ...current, name: saved.name })
      setName(saved.name)
    } catch (error) {
      // A duplicate name is the user's to fix, not a failure to report.
      if (!(error instanceof ApiError)) {
        trackException(error, { operation: 'save' })
      }
      setErrorMessage(describeFetchError(error, 'Unable to save checklist.'))
    } finally {
      setSubmitting(false)
    }
  }

  async function handleDelete() {
    setDeleting(true)
    setErrorMessage('')

    try {
      await deleteChecklist(id)
      trackEvent('ChecklistDeleted')
      void navigate('/')
    } catch (error) {
      trackException(error, { operation: 'delete' })
      setErrorMessage(describeFetchError(error, 'Unable to delete checklist.'))
      setDeleting(false)
    }
  }

  // Starts the fill-out on the device, from the checklist as the API has it now (the steps section may have
  // changed it since the page loaded) or, offline, as the device has it.
  async function handleFillOut() {
    setStarting(true)
    setErrorMessage('')

    try {
      const loaded = await loadChecklist(id)
      if (loaded === null) {
        setNotFound(true)
        return
      }
      const run = createLocalRun(
        loaded.data,
        newClientKey(),
        new Date().toISOString(),
      )
      await store.putRun(run)
      trackEvent('RunStarted')
      requestSync()
      void navigate(`/runs/${run.clientKey}`)
    } catch (error) {
      trackException(error, { operation: 'startRun' })
      setErrorMessage(
        describeFetchError(error, 'Unable to start filling out the checklist.'),
      )
      setStarting(false)
    }
  }

  const editing = submitting || deleting || starting || !online

  return (
    <Stack spacing={2}>
      <Box
        sx={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 1,
        }}
      >
        <Button component={Link} to="/">
          ← Back to checklists
        </Button>
        {checklist && (
          <Button
            type="button"
            variant="contained"
            disabled={submitting || deleting || starting}
            onClick={() => void handleFillOut()}
          >
            {starting ? 'Starting…' : 'Fill out'}
          </Button>
        )}
      </Box>

      {!online ? (
        <Alert severity="info">{offlineMessage}</Alert>
      ) : (
        fromCache && <Alert severity="info">{cachedCopyMessage}</Alert>
      )}

      {errorMessage && <Alert severity="error">{errorMessage}</Alert>}

      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
          <CircularProgress aria-label="Loading" />
        </Box>
      ) : (
        checklist && (
          <>
            <Paper component="section" elevation={2} sx={{ p: 3 }}>
              <Typography
                variant="h5"
                component="h2"
                sx={{ mb: 2, overflowWrap: 'anywhere' }}
              >
                {checklist.name}
              </Typography>
              <Box
                component="form"
                onSubmit={(event) => void handleSubmit(event)}
                sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}
              >
                <TextField
                  id="checklist-name"
                  label="Checklist name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  slotProps={{ htmlInput: { maxLength: 200 } }}
                  required
                />
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                  <Button type="submit" variant="contained" disabled={editing}>
                    {submitting ? 'Saving…' : 'Save changes'}
                  </Button>
                  <Button
                    type="button"
                    color="error"
                    variant="outlined"
                    disabled={editing}
                    onClick={() => void handleDelete()}
                  >
                    {deleting ? 'Deleting…' : 'Delete'}
                  </Button>
                </Stack>
              </Box>
            </Paper>
            <ChecklistSteps
              checklistId={id}
              initialSteps={checklist.steps}
              disabled={!online}
            />
            <ChecklistRuns checklistId={id} />
          </>
        )
      )}
    </Stack>
  )
}

function ChecklistDetailPage() {
  const id = parseId(useParams().id)
  if (id === null) {
    return <NotFoundPage />
  }
  // Keyed by id so going back or forward between two checklists starts each one with fresh state.
  return <ChecklistDetail key={id} id={id} />
}

export default ChecklistDetailPage
