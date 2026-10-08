import { useEffect, useRef, useState, type SubmitEvent } from 'react'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Divider from '@mui/material/Divider'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import { googleClientId, testSignInEnabled } from '../config'
import { loadGoogleIdentity, sessionFromGoogleCredential } from './google'
import { setSession } from './session'

function GoogleSignIn() {
  const buttonRef = useRef<HTMLDivElement>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    loadGoogleIdentity()
      .then((google) => {
        if (cancelled || buttonRef.current === null) {
          return
        }
        google.initialize({
          client_id: googleClientId,
          callback: ({ credential }) =>
            setSession(sessionFromGoogleCredential(credential)),
          // Signs a returning user straight back in, for example when their sign-in expires mid-session.
          auto_select: true,
          use_fedcm_for_prompt: true,
        })
        google.renderButton(buttonRef.current, {
          theme: 'outline',
          size: 'large',
          text: 'signin_with',
          shape: 'pill',
        })
        google.prompt()
      })
      .catch(() => {
        if (!cancelled) {
          setError(
            "Google sign-in couldn't load. Check your connection and reload the page.",
          )
        }
      })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <Box>
      <Box
        ref={buttonRef}
        sx={{ display: 'flex', justifyContent: 'center', minHeight: 44 }}
      />
      {error && (
        <Alert severity="error" sx={{ mt: 2 }}>
          {error}
        </Alert>
      )}
    </Box>
  )
}

function TestSignIn() {
  const [name, setName] = useState('Preview User')
  const trimmed = name.trim()

  function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    if (trimmed.length > 0) {
      setSession({ token: `test:${trimmed}`, name: trimmed, provider: 'test' })
    }
  }

  return (
    <Box component="form" onSubmit={handleSubmit} noValidate>
      <Typography variant="subtitle1" component="h3" sx={{ mb: 1 }}>
        Test sign-in
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Sign in as anyone, with no password. Each name has its own checklists.
        This is only available outside production.
      </Typography>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
        <TextField
          label="Name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          slotProps={{ htmlInput: { maxLength: 100 } }}
          size="small"
          fullWidth
        />
        <Button
          type="submit"
          variant="outlined"
          disabled={trimmed.length === 0}
          sx={{ flexShrink: 0 }}
        >
          Sign in as test user
        </Button>
      </Stack>
    </Box>
  )
}

function SignInPage() {
  const useGoogle = googleClientId.length > 0

  return (
    <Paper
      component="section"
      elevation={2}
      sx={{ p: 3, maxWidth: 480, mx: 'auto' }}
    >
      <Typography variant="h5" component="h2" align="center" sx={{ mb: 1 }}>
        Sign in
      </Typography>
      <Typography color="text.secondary" align="center" sx={{ mb: 3 }}>
        Sign in to see your checklists. Only you can see the checklists and
        fill-outs you create.
      </Typography>
      {useGoogle && <GoogleSignIn />}
      {useGoogle && testSignInEnabled && <Divider sx={{ my: 3 }} />}
      {testSignInEnabled && <TestSignIn />}
      {!useGoogle && !testSignInEnabled && (
        <Alert severity="error">
          Sign-in isn&apos;t set up for this site yet.
        </Alert>
      )}
    </Paper>
  )
}

export default SignInPage
