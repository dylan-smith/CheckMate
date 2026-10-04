import {
  ApplicationInsights,
  DistributedTracingModes,
} from '@microsoft/applicationinsights-web'
import { apiBaseUrl } from './config'

type Properties = Record<string, string>

let appInsights: ApplicationInsights | undefined

// Telemetry is only enabled when the build has a connection string (CI sets it for production), so local
// dev, unit tests and E2E runs send nothing.
export function initTelemetry() {
  const connectionString = import.meta.env.VITE_APPINSIGHTS_CONNECTION_STRING
  if (!connectionString || appInsights) {
    return
  }

  // This runs before the app mounts, so a bad configuration must leave telemetry off rather than stop the
  // page from rendering.
  try {
    const sdk = new ApplicationInsights({
      config: {
        connectionString,
        // W3C traceparent lets the API's OpenTelemetry pipeline continue the browser's trace.
        distributedTracingMode: DistributedTracingModes.W3C,
        enableCorsCorrelation: true,
        // Resolve against the page so a relative or empty base URL (same-origin API) still works.
        correlationHeaderDomains: [
          new URL(apiBaseUrl, window.location.origin).host,
        ],
        disableFetchTracking: false,
        enableUnhandledPromiseRejectionTracking: true,
        enableAutoRouteTracking: false,
        // Chrome blocks the unload event by default and logs a permissions policy violation when it's hooked.
        // The SDK still flushes on pagehide, visibilitychange and beforeunload.
        disablePageUnloadEvents: ['unload'],
      },
    })
    sdk.addTelemetryInitializer((item) => {
      item.tags = { ...item.tags, 'ai.cloud.role': 'CheckMate.Web' }
    })
    sdk.loadAppInsights()
    sdk.trackPageView()
    appInsights = sdk
  } catch (error) {
    console.error('Telemetry is disabled because it failed to start.', error)
  }
}

export function trackException(error: unknown, properties?: Properties) {
  appInsights?.trackException({
    exception: error instanceof Error ? error : new Error(String(error)),
    properties,
  })
}

export function trackEvent(name: string, properties?: Properties) {
  appInsights?.trackEvent({ name, properties })
}

// Only for tests, so each one starts with telemetry uninitialized.
export function resetTelemetry() {
  appInsights = undefined
}
