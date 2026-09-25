import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import Container from '@mui/material/Container'
import List from '@mui/material/List'
import ListItem from '@mui/material/ListItem'
import ListItemText from '@mui/material/ListItemText'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'

type Checklist = {
  id: number
  name: string
}

type ErrorResponse = {
  message?: string
}

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:5269'

// fetch rejects with a TypeError when the API can't be reached at all, including while a deployment has
// it paused (see the deploy-backend job in ci.yml), so tell the user to retry rather than show a generic error.
const unreachableMessage =
  "Can't reach CheckMate right now. It may be updating, so try again in a minute."

function describeFetchError(error: unknown, fallback: string) {
  return error instanceof TypeError ? unreachableMessage : fallback
}

function App() {
  const [checklists, setChecklists] = useState<Checklist[]>([])
  const [name, setName] = useState('')
  const [editingId, setEditingId] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')

  const isEditing = useMemo(() => editingId !== null, [editingId])
  const formTitle = useMemo(
    () => (isEditing ? 'Edit checklist' : 'Create checklist'),
    [isEditing],
  )

  useEffect(() => {
    void loadChecklists()
  }, [])

  async function loadChecklists() {
    setLoading(true)
    setErrorMessage('')

    try {
      const response = await fetch(`${apiBaseUrl}/api/checklists`)
      if (!response.ok) {
        throw new Error('Unable to load checklists.')
      }

      const payload = (await response.json()) as Checklist[]
      setChecklists(payload)
    } catch (error) {
      setErrorMessage(describeFetchError(error, 'Unable to load checklists.'))
    } finally {
      setLoading(false)
    }
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
      const response = await fetch(
        isEditing
          ? `${apiBaseUrl}/api/checklists/${editingId}`
          : `${apiBaseUrl}/api/checklists`,
        {
          method: isEditing ? 'PUT' : 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ name: trimmedName }),
        },
      )

      if (!response.ok) {
        if (response.status === 409) {
          const error = (await response.json()) as ErrorResponse
          setErrorMessage(
            error.message ?? 'A checklist with this name already exists.',
          )
          return
        }

        throw new Error('Unable to save checklist.')
      }

      setName('')
      setEditingId(null)
      await loadChecklists()
    } catch (error) {
      setErrorMessage(describeFetchError(error, 'Unable to save checklist.'))
    } finally {
      setSubmitting(false)
    }
  }

  function startEdit(checklist: Checklist) {
    setEditingId(checklist.id)
    setName(checklist.name)
    setErrorMessage('')
  }

  function cancelEdit() {
    setEditingId(null)
    setName('')
    setErrorMessage('')
  }

  async function deleteChecklist(id: number) {
    setErrorMessage('')

    try {
      const response = await fetch(`${apiBaseUrl}/api/checklists/${id}`, {
        method: 'DELETE',
      })

      if (!response.ok && response.status !== 404) {
        throw new Error('Unable to delete checklist.')
      }

      if (editingId === id) {
        cancelEdit()
      }

      await loadChecklists()
    } catch (error) {
      setErrorMessage(describeFetchError(error, 'Unable to delete checklist.'))
    }
  }

  return (
    <Container maxWidth="md" component="main" sx={{ py: 4 }}>
      <Typography variant="h3" component="h1" gutterBottom>
        CheckMate
      </Typography>
      <Typography variant="body1" color="text.secondary" sx={{ mb: 3 }}>
        Create, edit, and delete your custom checklists.
      </Typography>

      <Stack spacing={2}>
        <Paper component="section" elevation={2} sx={{ p: 3 }}>
          <Typography variant="h5" component="h2" sx={{ mb: 2 }}>
            {formTitle}
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
              placeholder="e.g. Daily chores"
            />
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
              <Button type="submit" variant="contained" disabled={submitting}>
                {submitting
                  ? 'Saving…'
                  : isEditing
                    ? 'Save changes'
                    : 'Create checklist'}
              </Button>
              {isEditing && (
                <Button type="button" variant="outlined" onClick={cancelEdit}>
                  Cancel
                </Button>
              )}
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
                  sx={{
                    flexDirection: { xs: 'column', sm: 'row' },
                    alignItems: { xs: 'stretch', sm: 'center' },
                    gap: 1,
                    pr: 0,
                  }}
                >
                  <ListItemText primary={checklist.name} sx={{ flexGrow: 1 }} />
                  <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                    <Button
                      type="button"
                      variant="outlined"
                      onClick={() => startEdit(checklist)}
                    >
                      Edit
                    </Button>
                    <Button
                      type="button"
                      color="error"
                      variant="contained"
                      onClick={() => void deleteChecklist(checklist.id)}
                    >
                      Delete
                    </Button>
                  </Stack>
                </ListItem>
              ))}
            </List>
          )}
        </Paper>
      </Stack>
    </Container>
  )
}

export default App
