import { useEffect } from 'react'
import Box from '@mui/material/Box'
import Container from '@mui/material/Container'
import Typography from '@mui/material/Typography'
import { Link, Route, Routes, useLocation } from 'react-router'
import logo from './assets/logo.svg'
import ChecklistDetailPage from './pages/ChecklistDetailPage'
import ChecklistsPage from './pages/ChecklistsPage'
import NotFoundPage from './pages/NotFoundPage'
import RunPage from './pages/RunPage'
import { trackPageView } from './telemetry'

function App() {
  const { pathname } = useLocation()

  // One page view for the first load and one for each route change after it, including back and forward.
  useEffect(() => {
    trackPageView()
  }, [pathname])

  return (
    <Container maxWidth="md" component="main" sx={{ py: 4 }}>
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

      <Routes>
        <Route path="/" element={<ChecklistsPage />} />
        <Route path="/checklists/:id" element={<ChecklistDetailPage />} />
        <Route path="/runs/:runId" element={<RunPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </Container>
  )
}

export default App
