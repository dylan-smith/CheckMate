import { useEffect, useState } from 'react'
import type { SubmitEvent } from 'react'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import List from '@mui/material/List'
import ListItem from '@mui/material/ListItem'
import ListItemButton from '@mui/material/ListItemButton'
import ListItemText from '@mui/material/ListItemText'
import Paper from '@mui/material/Paper'
import Slide from '@mui/material/Slide'
import type { SlideProps } from '@mui/material/Slide'
import Snackbar from '@mui/material/Snackbar'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import { Link, useLocation, useNavigate } from 'react-router'
import {
  ApiError,
  createChecklist,
  describeFetchError,
} from '../api/checklists'
import type { Checklist } from '../api/checklists'
import {
  loadChecklist,
  loadChecklists,
  prefetchChecklists,
} from '../offline/checklists'
import { newClientKey } from '../offline/clientKey'
import { useOnline } from '../offline/online'
import { createLocalRun } from '../offline/runs'
import { useLocalStore } from '../offline/store'
import { requestSync } from '../offline/sync'
import { trackEvent, trackException } from '../telemetry'

// How long a notice toast stays up, in milliseconds.
const noticeDuration = 4000

export const offlineMessage =
  "You're offline. Checklists saved on this device can still be filled out, but making or changing one needs a connection."

export const cachedCopyMessage =
  "CheckMate couldn't be reached, so this is the copy saved on this device."

// A page that navigates here can pass { notice } in the location state to show it as a toast.
function readNotice(state: unknown) {
  return typeof state === 'object' &&
    state !== null &&
    'notice' in state &&
    typeof state.notice === 'string'
    ? state.notice
    : ''
}

function SlideDown(props: SlideProps) {
  return <Slide {...props} direction="down" />
}

function ChecklistsPage() {
  const [checklists, setChecklists] = useState<Checklist[]>([])
  const [fromCache, setFromCache] = useState(false)
  const [name, setName] = useState('')
  const [loading, setLoading] = useState(true)
  const navigate = useNavigate()
  const location = useLocation()
  const online = useOnline()
  const store = useLocalStore()
  const [submitting, setSubmitting] = useState(false)
  // The checklist whose fill-out is being started, so its button can say so.
  const [startingId, setStartingId] = useState<number | null>(null)
  const [errorMessage, setErrorMessage] = useState('')
  // The text is kept after closing so it doesn't vanish while the toast slides away.
  const [notice] = useState(() => readNotice(location.state))
  const [noticeOpen, setNoticeOpen] = useState(notice !== '')

  useEffect(() => {
    void load()
  }, [])

  // Clear the notice from history so a reload or going back doesn't show it again.
  const hasLocationState = location.state != null
  useEffect(() => {
    if (hasLocationState) {
      void navigate('.', { replace: true, state: null })
    }
  }, [hasLocationState, navigate])

  async function load() {
    setLoading(true)
    setErrorMessage('')

    try {
      const loaded = await loadChecklists()
      setChecklists(loaded.data)
      setFromCache(loaded.fromCache)
      // Keeps every checklist's steps on the device too, so any of them can be filled out offline later.
      if (!loaded.fromCache) {
        prefetchChecklists(loaded.data)
      }
    } catch (error) {
      trackException(error, { operation: 'load' })
      setErrorMessage(describeFetchError(error, 'Unable to load checklists.'))
    } finally {
      setLoading(false)
    }
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
      await createChecklist(trimmedName)
      trackEvent('ChecklistCreated')
      setName('')
      await load()
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

  // Starts the fill-out on the device, from the checklist as the API has it or, offline, as the device has it.
  async function handleFillOut(checklistId: number) {
    setStartingId(checklistId)
    setErrorMessage('')

    try {
      const loaded = await loadChecklist(checklistId)
      if (loaded === null) {
        throw new Error('The checklist has been deleted.')
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
      setStartingId(null)
    }
  }

  return (
    <>
      <Stack spacing={2}>
        {!online ? (
          <Alert severity="info">{offlineMessage}</Alert>
        ) : (
          fromCache && <Alert severity="info">{cachedCopyMessage}</Alert>
        )}

        <Paper component="section" elevation={2} sx={{ p: 3 }}>
          <Typography variant="h5" component="h2" sx={{ mb: 2 }}>
            Create checklist
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
              placeholder="e.g. Daily chores"
            />
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
              <Button
                type="submit"
                variant="contained"
                disabled={submitting || !online}
              >
                {submitting ? 'Saving…' : 'Create checklist'}
              </Button>
            </Stack>
          </Box>
        </Paper>

        {errorMessage && <Alert severity="error">{errorMessage}</Alert>}

        <Paper component="section" elevation={2} sx={{ p: 3 }}>
          <Typography variant="h5" component="h2" sx={{ mb: 2 }}>
            Checklists
          </Typography>
          {loading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
              <CircularProgress aria-label="Loading" />
            </Box>
          ) : checklists.length === 0 ? (
            <Typography color="text.secondary">No checklists yet.</Typography>
          ) : (
            <List disablePadding>
              {checklists.map((checklist) => (
                <ListItem
                  key={checklist.id}
                  divider
                  disablePadding
                  sx={{ gap: 1 }}
                >
                  <ListItemButton
                    component={Link}
                    to={`/checklists/${checklist.id}`}
                  >
                    <ListItemText
                      primary={checklist.name}
                      sx={{ overflowWrap: 'anywhere' }}
                    />
                  </ListItemButton>
                  {/* Filling out is the most common thing to do with a checklist, so it's one click from here. */}
                  <Button
                    type="button"
                    variant="contained"
                    size="small"
                    sx={{ flexShrink: 0 }}
                    disabled={startingId !== null}
                    aria-label={`Fill out "${checklist.name}"`}
                    onClick={() => void handleFillOut(checklist.id)}
                  >
                    {startingId === checklist.id ? 'Starting…' : 'Fill out'}
                  </Button>
                </ListItem>
              ))}
            </List>
          )}
        </Paper>
      </Stack>

      <Snackbar
        open={noticeOpen}
        autoHideDuration={noticeDuration}
        anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
        slots={{ transition: SlideDown }}
        onClose={(_event, reason) => {
          // Only the timer or the close button dismisses it, not a click elsewhere on the page.
          if (reason !== 'clickaway') {
            setNoticeOpen(false)
          }
        }}
      >
        <Alert
          severity="success"
          variant="filled"
          onClose={() => setNoticeOpen(false)}
          sx={{ width: '100%' }}
        >
          {notice}
        </Alert>
      </Snackbar>
    </>
  )
}

export default ChecklistsPage
