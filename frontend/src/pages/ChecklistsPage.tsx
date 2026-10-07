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
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import { Link, useNavigate } from 'react-router'
import {
  ApiError,
  createChecklist,
  describeFetchError,
  listChecklists,
} from '../api/checklists'
import type { Checklist } from '../api/checklists'
import { startRun } from '../api/runs'
import { trackEvent, trackException } from '../telemetry'

function ChecklistsPage() {
  const [checklists, setChecklists] = useState<Checklist[]>([])
  const [name, setName] = useState('')
  const [loading, setLoading] = useState(true)
  const navigate = useNavigate()
  const [submitting, setSubmitting] = useState(false)
  // The checklist whose fill-out is being started, so its button can say so.
  const [startingId, setStartingId] = useState<number | null>(null)
  const [errorMessage, setErrorMessage] = useState('')

  useEffect(() => {
    void loadChecklists()
  }, [])

  async function loadChecklists() {
    setLoading(true)
    setErrorMessage('')

    try {
      setChecklists(await listChecklists())
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
      await loadChecklists()
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

  async function handleFillOut(checklistId: number) {
    setStartingId(checklistId)
    setErrorMessage('')

    try {
      const run = await startRun(checklistId)
      trackEvent('RunStarted')
      void navigate(`/runs/${run.id}`)
    } catch (error) {
      trackException(error, { operation: 'startRun' })
      setErrorMessage(
        describeFetchError(error, 'Unable to start filling out the checklist.'),
      )
      setStartingId(null)
    }
  }

  return (
    <Stack spacing={2}>
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
            <Button type="submit" variant="contained" disabled={submitting}>
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
  )
}

export default ChecklistsPage
