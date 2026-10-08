import { useState } from 'react'
import Chip from '@mui/material/Chip'
import Snackbar from '@mui/material/Snackbar'
import { useOnline } from './offline/online'
import { useSyncStatus } from './offline/sync'

// How long the synced notice stays up, in milliseconds.
const noticeDuration = 4000

// Says when the device is offline, or has fill-outs the API hasn't got yet. Nothing shows while everything is synced.
function SyncStatus() {
  const online = useOnline()
  const { syncing, pendingCount, lastError } = useSyncStatus()

  let label: string | null = null
  if (!online) {
    label = pendingCount > 0 ? `Offline, ${pendingCount} to sync` : 'Offline'
  } else if (syncing) {
    label = 'Syncing…'
  } else if (lastError !== null) {
    label = `${pendingCount} to sync, will retry`
  } else if (pendingCount > 0) {
    label = `${pendingCount} to sync`
  }

  if (label === null) {
    return null
  }
  return (
    <Chip
      role="status"
      size="small"
      variant="outlined"
      color={lastError !== null ? 'warning' : 'default'}
      label={label}
      title={lastError ?? undefined}
    />
  )
}

// A toast once fill-outs that had been waiting, say for a signal, have reached the API.
export function SyncNotice() {
  const { syncedBatches, lastSyncedCount } = useSyncStatus()
  // The batch the user last closed the notice for, so each new one shows once.
  const [seenBatch, setSeenBatch] = useState(syncedBatches)

  return (
    <Snackbar
      open={syncedBatches > seenBatch}
      autoHideDuration={noticeDuration}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      message={`Synced ${lastSyncedCount} fill-out${lastSyncedCount === 1 ? '' : 's'}.`}
      onClose={(_event, reason) => {
        if (reason !== 'clickaway') {
          setSeenBatch(syncedBatches)
        }
      }}
    />
  )
}

export default SyncStatus
