import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  initTelemetry,
  resetTelemetry,
  trackEvent,
  trackException,
} from '../telemetry'

const sdk = vi.hoisted(() => ({
  constructor: vi.fn(),
  addTelemetryInitializer: vi.fn(),
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
    constructor(options: unknown) {
      sdk.constructor(options)
    }
    addTelemetryInitializer = sdk.addTelemetryInitializer
    loadAppInsights = sdk.loadAppInsights
    trackPageView = sdk.trackPageView
    trackException = sdk.trackException
    trackEvent = sdk.trackEvent
  },
}))

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

      expect(sdk.constructor).not.toHaveBeenCalled()
      expect(sdk.trackEvent).not.toHaveBeenCalled()
      expect(sdk.trackException).not.toHaveBeenCalled()
    })
  })

  describe('with a connection string', () => {
    beforeEach(() => {
      vi.stubEnv('VITE_APPINSIGHTS_CONNECTION_STRING', 'InstrumentationKey=abc')
    })

    it('uses W3C tracing and only correlates requests to the API', () => {
      initTelemetry()

      expect(sdk.constructor).toHaveBeenCalledWith({
        config: expect.objectContaining({
          connectionString: 'InstrumentationKey=abc',
          distributedTracingMode: 2,
          enableCorsCorrelation: true,
          correlationHeaderDomains: ['localhost:5269'],
        }),
      })
      expect(sdk.loadAppInsights).toHaveBeenCalledOnce()
      expect(sdk.trackPageView).toHaveBeenCalledOnce()
    })

    it.each(['', '/'])(
      'correlates with the page origin when the API base URL is %j',
      (apiBaseUrl) => {
        config.apiBaseUrl = apiBaseUrl

        initTelemetry()

        expect(sdk.constructor).toHaveBeenCalledWith({
          config: expect.objectContaining({
            correlationHeaderDomains: [window.location.host],
          }),
        })
      },
    )

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
