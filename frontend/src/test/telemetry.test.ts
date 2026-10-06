import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  initTelemetry,
  resetTelemetry,
  trackEvent,
  trackException,
  trackPageView,
} from '../telemetry'

type TelemetryItem = { tags?: Record<string, string> }

const sdk = vi.hoisted(() => ({
  constructor: vi.fn<(options: { config: Record<string, unknown> }) => void>(),
  addTelemetryInitializer:
    vi.fn<(initializer: (item: TelemetryItem) => void) => void>(),
  loadAppInsights: vi.fn(),
  trackPageView: vi.fn(),
  trackException: vi.fn(),
  trackEvent: vi.fn(),
}))

const config = vi.hoisted(() => ({ apiBaseUrl: 'http://localhost:5269' }))

vi.mock('../config', () => ({
  get apiBaseUrl() {
    return config.apiBaseUrl
  },
}))

vi.mock('@microsoft/applicationinsights-web', () => ({
  DistributedTracingModes: { W3C: 2 },
  ApplicationInsights: class {
    constructor(options: { config: Record<string, unknown> }) {
      sdk.constructor(options)
    }
    addTelemetryInitializer = sdk.addTelemetryInitializer
    loadAppInsights = sdk.loadAppInsights
    trackPageView = sdk.trackPageView
    trackException = sdk.trackException
    trackEvent = sdk.trackEvent
  },
}))

// The config the SDK was created with.
function sdkConfig() {
  return sdk.constructor.mock.calls[0][0].config
}

beforeEach(() => {
  resetTelemetry()
  config.apiBaseUrl = 'http://localhost:5269'
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.clearAllMocks()
})

describe('telemetry', () => {
  describe('without a connection string', () => {
    it('does not create the SDK and the helpers do nothing', () => {
      vi.stubEnv('VITE_APPINSIGHTS_CONNECTION_STRING', '')

      initTelemetry()
      trackEvent('Something')
      trackException(new Error('boom'))
      trackPageView()

      expect(sdk.constructor).not.toHaveBeenCalled()
      expect(sdk.trackEvent).not.toHaveBeenCalled()
      expect(sdk.trackException).not.toHaveBeenCalled()
      expect(sdk.trackPageView).not.toHaveBeenCalled()
    })
  })

  describe('with a connection string', () => {
    beforeEach(() => {
      vi.stubEnv('VITE_APPINSIGHTS_CONNECTION_STRING', 'InstrumentationKey=abc')
    })

    it('uses W3C tracing and only correlates requests to the API', () => {
      initTelemetry()

      expect(sdkConfig()).toMatchObject({
        connectionString: 'InstrumentationKey=abc',
        distributedTracingMode: 2,
        enableCorsCorrelation: true,
        correlationHeaderDomains: ['localhost:5269'],
      })
      expect(sdk.loadAppInsights).toHaveBeenCalledOnce()
    })

    it('leaves page views to the router instead of tracking routes itself', () => {
      initTelemetry()

      expect(sdkConfig()).toMatchObject({ enableAutoRouteTracking: false })
      expect(sdk.trackPageView).not.toHaveBeenCalled()
    })

    it('tracks a page view for the current URL', () => {
      initTelemetry()
      window.history.pushState({}, '', '/checklists/7')

      trackPageView()

      expect(sdk.trackPageView).toHaveBeenCalledWith({
        uri: `${window.location.origin}/checklists/7`,
      })
      window.history.pushState({}, '', '/')
    })

    it.each(['', '/'])(
      'correlates with the page origin when the API base URL is %j',
      (apiBaseUrl) => {
        config.apiBaseUrl = apiBaseUrl

        initTelemetry()

        expect(sdkConfig()).toMatchObject({
          correlationHeaderDomains: [window.location.host],
        })
      },
    )

    it('does not hook the unload event', () => {
      initTelemetry()

      expect(sdkConfig()).toMatchObject({
        disablePageUnloadEvents: ['unload'],
      })
    })

    it('leaves telemetry off instead of throwing when setup fails', () => {
      config.apiBaseUrl = 'http://'
      const consoleError = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {})

      expect(() => initTelemetry()).not.toThrow()
      trackEvent('Something')

      expect(consoleError).toHaveBeenCalled()
      expect(sdk.trackEvent).not.toHaveBeenCalled()
      consoleError.mockRestore()
    })

    it('sets the cloud role name on every item', () => {
      initTelemetry()

      const initializer = sdk.addTelemetryInitializer.mock.calls[0][0]
      const item = { tags: { existing: 'tag' } }
      initializer(item)

      expect(item.tags).toEqual({
        existing: 'tag',
        'ai.cloud.role': 'CheckMate.Web',
      })
    })

    it('only initializes once', () => {
      initTelemetry()
      initTelemetry()

      expect(sdk.constructor).toHaveBeenCalledOnce()
    })

    it('forwards events and exceptions to the SDK', () => {
      initTelemetry()
      trackEvent('ChecklistCreated', { source: 'test' })
      trackException('not an error', { operation: 'load' })

      expect(sdk.trackEvent).toHaveBeenCalledWith({
        name: 'ChecklistCreated',
        properties: { source: 'test' },
      })
      expect(sdk.trackException).toHaveBeenCalledWith({
        exception: new Error('not an error'),
        properties: { operation: 'load' },
      })
    })
  })
})
