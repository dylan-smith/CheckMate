import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
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
  getChecklist,
  updateChecklist,
} from '../api/checklists'
import type { Checklist } from '../api/checklists'
import { trackEvent, trackException } from '../telemetry'
import NotFoundPage from './NotFoundPage'

// Only positive whole numbers can be checklist ids, so anything else can't match one.
function parseId(value: string | undefined) {
  return value && /^[1-9]\d*$/.test(value) ? Number(value) : null
}

function ChecklistDetail({ id }: { id: number }) {
  const navigate = useNavigate()
  const [checklist, setChecklist] = useState<Checklist | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [name, setName] = useState('')
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')

  useEffect(() => {
    // Ignore a response that arrives after the user has left the page.
    let current = true
    getChecklist(id)
      .then((loaded) => {
        if (!current) {
          return
        }
        if (loaded === null) {
          setNotFound(true)
        } else {
          setChecklist(loaded)
          setName(loaded.name)
        }
      })
      .catch((error: unknown) => {
        if (!current) {
          return
        }
        trackException(error, { operation: 'load' })
        setErrorMessage(describeFetchError(error, 'Unable to load checklist.'))
      })
      .finally(() => {
        if (current) {
          setLoading(false)
        }
      })

    return () => {
      current = false
    }
  }, [id])

  if (notFound) {
    return (
      <NotFoundPage message="That checklist doesn't exist. It may have been deleted." />
    )
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
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
      setChecklist(saved)
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

  return (
    <Stack spacing={2}>
      <Box>
        <Button component={Link} to="/">
          ← Back to checklists
        </Button>
      </Box>

      {errorMessage && <Alert severity="error">{errorMessage}</Alert>}

      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
          <CircularProgress aria-label="Loading" />
        </Box>
      ) : (
        checklist && (
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
              onSubmit={handleSubmit}
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
                <Button
                  type="submit"
                  variant="contained"
                  disabled={submitting || deleting}
                >
                  {submitting ? 'Saving…' : 'Save changes'}
                </Button>
                <Button
                  type="button"
                  color="error"
                  variant="outlined"
                  disabled={submitting || deleting}
                  onClick={() => void handleDelete()}
                >
                  {deleting ? 'Deleting…' : 'Delete'}
                </Button>
              </Stack>
            </Box>
          </Paper>
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
