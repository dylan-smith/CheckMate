import { useEffect, useState } from 'react'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import List from '@mui/material/List'
import ListItem from '@mui/material/ListItem'
import ListItemButton from '@mui/material/ListItemButton'
import ListItemText from '@mui/material/ListItemText'
import Paper from '@mui/material/Paper'
import Typography from '@mui/material/Typography'
import { Link } from 'react-router'
import { describeFetchError } from '../api/checklists'
import { deleteRun, getRuns } from '../api/runs'
import type { ChecklistRunSummary } from '../api/runs'
import { trackEvent, trackException } from '../telemetry'
import { formatDateTime } from './formatDateTime'

// Past fill-outs of a checklist. Each one opens on the run page, which resumes one in progress and shows a
// completed one read-only. Either kind can be deleted from here.
function ChecklistRuns({ checklistId }: { checklistId: number }) {
  const [runs, setRuns] = useState<ChecklistRunSummary[] | null>(null)
  const [errorMessage, setErrorMessage] = useState('')
  const [deleteErrorMessage, setDeleteErrorMessage] = useState('')
  const [deletingId, setDeletingId] = useState<number | null>(null)

  useEffect(() => {
    // Ignore a response that arrives after the user has left the page.
    let current = true

    async function loadRuns() {
      try {
        const loaded = await getRuns(checklistId)
        if (current) {
          setRuns(loaded)
        }
      } catch (error) {
        if (!current) {
          return
        }
        trackException(error, { operation: 'loadRuns' })
        setErrorMessage(describeFetchError(error, 'Unable to load fill-outs.'))
      }
    }

    void loadRuns()

    return () => {
      current = false
    }
  }, [checklistId])

  async function handleDelete(runId: number) {
    setDeletingId(runId)
    setDeleteErrorMessage('')

    try {
      await deleteRun(runId)
      trackEvent('RunDeleted')
      setRuns((current) => current && current.filter((run) => run.id !== runId))
    } catch (error) {
      trackException(error, { operation: 'deleteRun' })
      setDeleteErrorMessage(
        describeFetchError(error, 'Unable to delete this fill-out.'),
      )
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <Paper component="section" elevation={2} sx={{ p: 3 }}>
      <Typography variant="h6" component="h3" sx={{ mb: 2 }}>
        Fill-outs
      </Typography>

      {deleteErrorMessage && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {deleteErrorMessage}
        </Alert>
      )}

      {errorMessage ? (
        <Alert severity="error">{errorMessage}</Alert>
      ) : runs === null ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
          <CircularProgress aria-label="Loading fill-outs" />
        </Box>
      ) : runs.length === 0 ? (
        <Typography color="text.secondary">No fill-outs yet.</Typography>
      ) : (
        <List disablePadding aria-label="Fill-outs">
          {runs.map((run) => {
            const startedAt = formatDateTime(run.startedAt)
            return (
              <ListItem key={run.id} divider disablePadding sx={{ gap: 1 }}>
                <ListItemButton component={Link} to={`/runs/${run.id}`}>
                  <ListItemText
                    primary={`Started ${startedAt}`}
                    secondary={
                      run.completedAt
                        ? `Completed ${formatDateTime(run.completedAt)}`
                        : 'In progress'
                    }
                  />
                </ListItemButton>
                <Button
                  type="button"
                  size="small"
                  color="error"
                  sx={{ flexShrink: 0 }}
                  disabled={deletingId !== null}
                  aria-label={`Delete fill-out started ${startedAt}`}
                  onClick={() => void handleDelete(run.id)}
                >
                  {deletingId === run.id ? 'Deleting…' : 'Delete'}
                </Button>
              </ListItem>
            )
          })}
        </List>
      )}
    </Paper>
  )
}

export default ChecklistRuns
