import { Component } from 'react'
import type { ReactNode } from 'react'
import Alert from '@mui/material/Alert'
import Container from '@mui/material/Container'

type Props = {
  children: ReactNode
}

type State = {
  hasError: boolean
}

// Shows a fallback instead of a blank page. Errors are reported to telemetry by the root's onCaughtError
// handler in main.tsx, so this doesn't report them itself.
class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false }

  static getDerivedStateFromError(): State {
    return { hasError: true }
  }

  render() {
    if (this.state.hasError) {
      return (
        <Container maxWidth="md" component="main" sx={{ py: 4 }}>
          <Alert severity="error">
            Something went wrong. Reload the page to try again.
          </Alert>
        </Container>
      )
    }

    return this.props.children
  }
}

export default ErrorBoundary
