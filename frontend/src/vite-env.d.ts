/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string
  readonly VITE_APPINSIGHTS_CONNECTION_STRING?: string
  readonly VITE_GOOGLE_CLIENT_ID?: string
  readonly VITE_ENABLE_TEST_SIGN_IN?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
