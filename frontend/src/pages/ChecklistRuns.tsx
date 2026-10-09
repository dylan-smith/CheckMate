import { useEffect, useState } from 'react'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
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
import { isDirty, useLocalStore } from '../offline/store'
import type { LocalRun } from '../offline/store'
import { requestSync } from '../offline/sync'
import { trackEvent, trackException } from '../telemetry'
import { formatDateTime } from './formatDateTime'

export const offlineRunsMessage =
  "Showing the fill-outs saved on this device. Others will show once you're online."

// One fill-out in the list: the device's copy when it has one, since that's the latest, or else the API's.
type Row = {
  clientKey: string
  serverId: number | null
  startedAt: string
  completedAt: string | null
  local: LocalRun | null
}

function merge(serverRuns: ChecklistRunSummary[], localRuns: LocalRun[]) {
  const localByKey = new Map(localRuns.map((run) => [run.clientKey, run]))
  const rows: Row[] = []
  for (const run of serverRuns) {
    // A fill-out deleted on the device is gone, even while the API still has it.
    if (!localByKey.has(run.clientKey)) {
      rows.push({ ...run, serverId: run.id, local: null })
    }
  }
  for (const run of localRuns) {
    if (run.deletedAt === null) {
      rows.push({
        clientKey: run.clientKey,
        serverId: run.serverId,
        startedAt: run.startedAt,
        completedAt: run.completedAt,
        local: run,
      })
    }
  }
  return rows.sort(
    (a, b) =>
      b.startedAt.localeCompare(a.startedAt) ||
      (b.serverId ?? 0) - (a.serverId ?? 0),
  )
}

// Past fill-outs of a checklist: the ones the API has, and the ones this device has, which may be ahead of the
// API or not there yet. Each one opens on the run page, which resumes one in progress and shows a completed one
// read-only. Either kind can be deleted from here.
function ChecklistRuns({ checklistId }: { checklistId: number }) {
  const store = useLocalStore()
  const [serverRuns, setServerRuns] = useState<ChecklistRunSummary[] | null>(
    null,
  )
  const [localRuns, setLocalRuns] = useState<LocalRun[] | null>(null)
  // The API couldn't be reached, so only the device's fill-outs show.
  const [offline, setOffline] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const [deleteErrorMessage, setDeleteErrorMessage] = useState('')
  const [deletingKey, setDeletingKey] = useState<string | null>(null)

  useEffect(() => {
    // Ignore a response that arrives after the user has left the page.
    let current = true

    async function loadServerRuns() {
      try {
        const loaded = await getRuns(checklistId)
        if (current) {
          setServerRuns(loaded)
          setOffline(false)
        }
      } catch (error) {
        if (!current) {
          return
        }
        if (error instanceof TypeError) {
          setOffline(true)
          setServerRuns([])
          return
        }
        trackException(error, { operation: 'loadRuns' })
        setErrorMessage(describeFetchError(error, 'Unable to load fill-outs.'))
      }
    }

    async function loadLocalRuns() {
      try {
        const loaded = await store.listRuns(checklistId)
        if (current) {
          setLocalRuns(loaded)
        }
      } catch {
        // A device that can't keep fill-outs has none to show.
        if (current) {
          setLocalRuns([])
        }
      }
    }

    void loadServerRuns()
    void loadLocalRuns()
    // The sync engine changes the device's copies and, through them, the API's, so the list follows both.
    const unsubscribe = store.subscribe(() => {
      void loadLocalRuns()
      void loadServerRuns()
    })

    return () => {
      current = false
      unsubscribe()
    }
  }, [checklistId, store])

  async function handleDelete(row: Row) {
    setDeletingKey(row.clientKey)
    setDeleteErrorMessage('')

    try {
      if (row.local !== null) {
        // Deleted from the API when the device next syncs.
        await store.deleteRun(row.clientKey)
        requestSync()
      } else if (row.serverId !== null) {
        await deleteRun(row.serverId)
        setServerRuns(
          (current) =>
            current && current.filter((run) => run.id !== row.serverId),
        )
      }
      trackEvent('RunDeleted')
    } catch (error) {
      trackException(error, { operation: 'deleteRun' })
      setDeleteErrorMessage(
        describeFetchError(error, 'Unable to delete this fill-out.'),
      )
    } finally {
      setDeletingKey(null)
    }
  }

  const rows =
    serverRuns === null || localRuns === null
      ? null
      : merge(serverRuns, localRuns)

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

      {offline && (
        <Typography color="text.secondary" sx={{ mb: 2 }}>
          {offlineRunsMessage}
        </Typography>
      )}

      {errorMessage ? (
        <Alert severity="error">{errorMessage}</Alert>
      ) : rows === null ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
          <CircularProgress aria-label="Loading fill-outs" />
        </Box>
      ) : rows.length === 0 ? (
        <Typography color="text.secondary">No fill-outs yet.</Typography>
      ) : (
        <List disablePadding aria-label="Fill-outs">
          {rows.map((row) => {
            const startedAt = formatDateTime(row.startedAt)
            // A fill-out the API hasn't got as it is here, or has said no to.
            const chip =
              row.local?.syncError?.kind === 'rejected'
                ? 'Sync failed'
                : row.local !== null && isDirty(row.local)
                  ? 'Not synced'
                  : null
            return (
              <ListItem
                key={row.clientKey}
                divider
                disablePadding
                sx={{ gap: 1 }}
              >
                <ListItemButton component={Link} to={`/runs/${row.clientKey}`}>
                  <ListItemText
                    primary={`Started ${startedAt}`}
                    secondary={
                      row.completedAt
                        ? `Completed ${formatDateTime(row.completedAt)}`
                        : 'In progress'
                    }
                  />
                  {chip && (
                    <Chip
                      size="small"
                      variant="outlined"
                      color={chip === 'Sync failed' ? 'warning' : 'default'}
                      label={chip}
                      sx={{ ml: 1, flexShrink: 0 }}
                    />
                  )}
                </ListItemButton>
                <Button
                  type="button"
                  size="small"
                  color="error"
                  sx={{ flexShrink: 0 }}
                  disabled={deletingKey !== null}
                  aria-label={`Delete fill-out started ${startedAt}`}
                  onClick={() => void handleDelete(row)}
                >
                  {deletingKey === row.clientKey ? 'Deleting…' : 'Delete'}
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
