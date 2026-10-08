import { useEffect } from 'react'
import Avatar from '@mui/material/Avatar'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Container from '@mui/material/Container'
import Typography from '@mui/material/Typography'
import { Link, Route, Routes, useLocation } from 'react-router'
import logo from './assets/logo.svg'
import { disableGoogleAutoSelect } from './auth/google'
import { setSession, useSession } from './auth/session'
import SignInPage from './auth/SignInPage'
import ChecklistDetailPage from './pages/ChecklistDetailPage'
import ChecklistsPage from './pages/ChecklistsPage'
import NotFoundPage from './pages/NotFoundPage'
import RunPage from './pages/RunPage'
import { trackPageView } from './telemetry'

function signOut() {
  disableGoogleAutoSelect()
  setSession(null)
}

function App() {
  const { pathname } = useLocation()
  const session = useSession()

  // One page view for the first load and one for each route change after it, including back and forward.
  useEffect(() => {
    trackPageView()
  }, [pathname])

  return (
    <Container maxWidth="md" component="main" sx={{ py: 4 }}>
      {session && (
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-end',
            gap: 1,
            mb: 1,
          }}
        >
          <Avatar
            src={session.pictureUrl}
            alt=""
            sx={{ width: 28, height: 28, fontSize: 14 }}
          >
            {session.name.charAt(0).toUpperCase()}
          </Avatar>
          <Typography variant="body2" noWrap sx={{ minWidth: 0 }}>
            {session.name}
          </Typography>
          <Button size="small" onClick={signOut} sx={{ flexShrink: 0 }}>
            Sign out
          </Button>
        </Box>
      )}
      <Typography variant="h3" component="h1" gutterBottom>
        <Box
          component={Link}
          to="/"
          sx={{ display: 'block', width: 'fit-content', mx: 'auto' }}
        >
          <Box
            component="img"
            src={logo}
            alt="CheckMate"
            sx={{ display: 'block', height: 120 }}
          />
        </Box>
      </Typography>
      <Typography
        variant="body1"
        color="text.secondary"
        align="center"
        sx={{ mb: 3 }}
      >
        Build a checklist once, run it every time, and keep a record of every
        run.
      </Typography>

      {session === null ? (
        <SignInPage />
      ) : (
        <Routes>
          <Route path="/" element={<ChecklistsPage />} />
          <Route path="/checklists/:id" element={<ChecklistDetailPage />} />
          <Route path="/runs/:runId" element={<RunPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      )}
    </Container>
  )
}

export default App
