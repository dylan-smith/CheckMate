import type { Session } from './session'

// The parts of Google Identity Services (https://developers.google.com/identity/gsi/web) this app uses. It's
// loaded from Google as a script rather than installed, as Google requires.
type CredentialResponse = { credential: string }

type GoogleAccountsId = {
  initialize(options: {
    client_id: string
    callback: (response: CredentialResponse) => void
    auto_select?: boolean
    use_fedcm_for_prompt?: boolean
  }): void
  renderButton(
    parent: HTMLElement,
    options: {
      type?: 'standard' | 'icon'
      theme?: 'outline' | 'filled_blue' | 'filled_black'
      size?: 'large' | 'medium' | 'small'
      text?: 'signin_with' | 'signup_with' | 'continue_with' | 'signin'
      shape?: 'rectangular' | 'pill'
    },
  ): void
  prompt(): void
  disableAutoSelect(): void
}

declare global {
  interface Window {
    google?: { accounts: { id: GoogleAccountsId } }
  }
}

const scriptUrl = 'https://accounts.google.com/gsi/client'

let loading: Promise<GoogleAccountsId> | undefined

export function loadGoogleIdentity(): Promise<GoogleAccountsId> {
  loading ??= new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = scriptUrl
    script.async = true
    script.onload = () => {
      if (window.google) {
        resolve(window.google.accounts.id)
      } else {
        reject(new Error('Google sign-in did not load.'))
      }
    }
    script.onerror = () => {
      // Let a later attempt try again, for example once the network is back.
      loading = undefined
      reject(new Error('Google sign-in did not load.'))
    }
    document.head.appendChild(script)
  })
  return loading
}

type IdTokenPayload = {
  name?: string
  email?: string
  picture?: string
}

// Reads the user's name and email from the ID token for display. The API checks the token itself.
export function sessionFromGoogleCredential(credential: string): Session {
  const payload = JSON.parse(
    decodeBase64Url(credential.split('.')[1] ?? ''),
  ) as IdTokenPayload
  return {
    token: credential,
    name: payload.name ?? payload.email ?? 'Google user',
    email: payload.email,
    pictureUrl: payload.picture,
    provider: 'google',
  }
}

function decodeBase64Url(value: string) {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/')
  const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

// Stops Google signing the user straight back in after they sign out.
export function disableGoogleAutoSelect() {
  window.google?.accounts.id.disableAutoSelect()
}
