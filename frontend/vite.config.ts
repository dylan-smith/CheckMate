import { configDefaults, defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    // A service worker serves the app itself (index.html, the bundles, the icons) so it opens with no connection,
    // and the manifest lets it be installed on a phone's home screen. It caches nothing else: the API, Google
    // sign-in and telemetry are on other origins and always go to the network, and data is kept by the app.
    VitePWA({
      // A new version waits until the user chooses to reload (see src/pwa/UpdatePrompt.tsx), rather than
      // reloading the page in the middle of a fill-out.
      registerType: 'prompt',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'CheckMate',
        short_name: 'CheckMate',
        description:
          'Build a checklist once, run it every time, and keep a record of every run.',
        id: '/',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        theme_color: '#0e2841',
        background_color: '#f3f4f6',
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'maskable-icon-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // Everything the app needs to open: the default leaves out the logo and the icons.
        globPatterns: ['**/*.{js,css,html,svg,png}'],
        // Every page is index.html, so deep links open offline too.
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
        // One sw.js rather than sw.js plus a workbox-<hash>.js, so deploying has one file to mark no-cache.
        inlineWorkboxRuntime: true,
      },
      devOptions: { enabled: false },
    }),
  ],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test/setup.ts',
    css: true,
    exclude: [...configDefaults.exclude, 'e2e/**'],
    reporters: process.env.CI ? ['default', 'junit'] : ['default'],
    outputFile: { junit: 'vitest-report/results.xml' },
    // Only collected when run with --coverage, as CI does.
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/test/**', 'src/**/*.test.{ts,tsx}'],
      reporter: ['text', 'json-summary'],
      reportsDirectory: 'coverage',
    },
  },
})
