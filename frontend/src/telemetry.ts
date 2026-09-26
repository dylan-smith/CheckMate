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

  appInsights = new ApplicationInsights({
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
    },
  })
  appInsights.addTelemetryInitializer((item) => {
    item.tags = { ...item.tags, 'ai.cloud.role': 'CheckMate.Web' }
  })
  appInsights.loadAppInsights()
  appInsights.trackPageView()
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
