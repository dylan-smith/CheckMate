import Button from '@mui/material/Button'
import Snackbar from '@mui/material/Snackbar'
import { useRegisterSW } from 'virtual:pwa-register/react'

// An installed app can stay open for days, and the browser only looks for a new service worker when a page loads.
const updateCheckIntervalMs = 60 * 60 * 1000

// Registers the service worker that serves the app offline, and offers to reload once a new version is ready. The
// new version waits for that, so a reload can't interrupt a fill-out.
function UpdatePrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, registration) {
      if (!registration) {
        return
      }
      setInterval(() => {
        if (navigator.onLine && !registration.installing) {
          void registration.update()
        }
      }, updateCheckIntervalMs)
    },
  })

  return (
    <Snackbar
      open={needRefresh}
      message="A new version of CheckMate is available."
      onClose={(_event, reason) => {
        if (reason !== 'clickaway') {
          setNeedRefresh(false)
        }
      }}
      action={
        <Button
          color="inherit"
          size="small"
          onClick={() => void updateServiceWorker()}
        >
          Reload
        </Button>
      }
    />
  )
}

export default UpdatePrompt
