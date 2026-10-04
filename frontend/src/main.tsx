import { StrictMode } from 'react'
import CssBaseline from '@mui/material/CssBaseline'
import { ThemeProvider, createTheme } from '@mui/material/styles'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import ErrorBoundary from './ErrorBoundary.tsx'
import { initTelemetry, trackException } from './telemetry.ts'

initTelemetry()

const theme = createTheme({
  palette: {
    mode: 'light',
    primary: {
      main: '#0e2841',
    },
    secondary: {
      main: '#1b9a57',
    },
    background: {
      default: '#f3f4f6',
    },
    text: {
      primary: '#111827',
    },
  },
  typography: {
    fontFamily: 'Inter, system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
  },
})

// Setting these replaces React's default console logging, so keep logging as well as reporting.
function reportRootError(kind: string) {
  return (error: unknown) => {
    console.error(error)
    trackException(error, { kind })
  }
}

createRoot(document.getElementById('root')!, {
  onUncaughtError: reportRootError('uncaught'),
  onCaughtError: reportRootError('caught'),
  onRecoverableError: reportRootError('recoverable'),
}).render(
  <StrictMode>
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </ThemeProvider>
  </StrictMode>,
)
