import { describe, expect, it, vi } from 'vitest'
import { readFile } from 'node:fs/promises'
import * as smoke from './preview-browser-smoke.mjs'
import {
  acknowledgeInitialSpoilerDisclaimer,
  appAssetFailure,
  assertCloudflareWebAnalyticsContract,
  assertNoBrowserSecurityErrors,
  assertPreviewReadOnly,
  assertRouteDataHealthy,
  assertSurfaceNavigation,
  BrowserDeploymentPropagationError,
  BROWSER_SMOKE_ROUTES,
  deploymentHttpStatusFailure,
  formatPreviewSmokeReport,
  initialDocumentDeliveryFailure,
  classifyAnalyticsRequest,
  runBrowserSmoke,
  withDeploymentPropagationRetry,
  waitForRouteReady,
} from './preview-browser-smoke.mjs'

const cloudflareBeaconUrl = 'https://static.cloudflareinsights.com/beacon.min.js'
const cloudflareRumUrl = 'https://cloudflareinsights.com/cdn-cgi/rum'
const publicBeaconConfiguration = JSON.stringify({ token: 'a'.repeat(32) })

function cloudflareBeaconScript(overrides = {}) {
  return {
    dataCfBeacon: publicBeaconConfiguration,
    src: cloudflareBeaconUrl,
    type: 'module',
    ...overrides,
  }
}

function analyticsObservation(overrides = {}) {
  return {
    failure: '',
    kind: 'cloudflare-rum',
    method: 'POST',
    responseUrl: cloudflareRumUrl,
    status: 204,
    url: cloudflareRumUrl,
    ...overrides,
  }
}

function assetResponse(url, status, contentType) {
  return {
    headers: () => ({ 'content-type': contentType }),
    status: () => status,
    url: () => url,
  }
}

describe('preview browser smoke diagnostics', () => {
  it('rejects synthetic or stale response bytes even when the browser surface passes', () => {
    expect(smoke.assertBuiltArtifactResponse).toBeTypeOf('function')
    const current = Buffer.from('<html>current Vite entry</html>')
    expect(() => smoke.assertBuiltArtifactResponse(current, Buffer.from('<html>synthetic PASS</html>'))).toThrow(/built artifact/)
    expect(() => smoke.assertBuiltArtifactResponse(current, Buffer.from('<html>old Vite entry</html>'))).toThrow(/built artifact/)
    expect(() => smoke.assertBuiltArtifactResponse(current, Buffer.from(current))).not.toThrow()
  })
  it('routes the current Vite build rather than replacing the application in the harness', async () => {
    const harness = await readFile('scripts/preview-browser-smoke.harness.mjs', 'utf8')
    expect(harness).toContain("readFile(new URL('../dist/index.html', import.meta.url))")
    expect(harness).not.toContain('/fixture.js')
  })
  it('exposes the real browser loop for intercepted-browser contract scenarios', () => {
    expect(runBrowserSmoke).toBeTypeOf('function')
  })

  it('rejects a redirected RUM response even when another POST succeeded', () => {
    expect(() => assertCloudflareWebAnalyticsContract({
      isPreview: false,
      scripts: [cloudflareBeaconScript()],
      observations: [
        analyticsObservation({ kind: 'cloudflare-beacon', method: 'GET', url: cloudflareBeaconUrl, responseUrl: cloudflareBeaconUrl, status: 200 }),
        analyticsObservation(),
        analyticsObservation({ responseUrl: 'https://unexpected.example/rum' }),
      ],
      surfaceOrigin: 'https://miku.sekai.today',
    })).toThrow(/unexpected endpoint/i)
  })

  it('does not leak malformed beacon configuration in errors', () => {
    const malformed = 'private-value-that-must-not-be-logged'
    expect(() => assertCloudflareWebAnalyticsContract({
      isPreview: false,
      scripts: [cloudflareBeaconScript({ dataCfBeacon: malformed })],
    })).toThrow(/configuration/i)
    try {
      assertCloudflareWebAnalyticsContract({ isPreview: false, scripts: [cloudflareBeaconScript({ dataCfBeacon: malformed })] })
    } catch (error) {
      expect(error.message).not.toContain(malformed)
    }
  })
  it('visits the catalog, events, and representative song routes', () => {
    expect(BROWSER_SMOKE_ROUTES).toEqual(['/', '/#/events', '/#/songs/39-music'])
  })

  it('acknowledges the required spoiler disclaimer before waiting for route requests', async () => {
    const click = vi.fn()
    const waitFor = vi.fn()
    const button = { click }
    const dialogGetByRole = vi.fn(() => button)
    const dialog = { getByRole: dialogGetByRole, waitFor }
    const getByRole = vi.fn(() => dialog)

    await acknowledgeInitialSpoilerDisclaimer({ getByRole })

    expect(getByRole).toHaveBeenCalledWith('alertdialog', { name: '스포일러 안내' })
    expect(waitFor).toHaveBeenNthCalledWith(1, { state: 'visible' })
    expect(dialogGetByRole).toHaveBeenCalledWith('button', { name: '확인하고 계속하기' })
    expect(click).toHaveBeenCalledOnce()
    expect(waitFor).toHaveBeenNthCalledWith(2, { state: 'detached' })
  })

  it('polls semantic route readiness without fixed animation frames', async () => {
    const waitFor = vi.fn()
    const waitForFunction = vi.fn()
    const page = { getByRole: vi.fn(() => ({ waitFor })), waitForFunction }

    await waitForRouteReady(page)

    expect(waitFor).toHaveBeenCalledWith({ state: 'visible' })
    expect(waitForFunction).toHaveBeenCalledOnce()
  })

  it('fails a handled data-error screen instead of treating it as route readiness', async () => {
    const page = {
      evaluate: vi.fn().mockResolvedValue({
        alertText: 'Manifest load failed.',
        hasExpectedContent: false,
      }),
      waitForFunction: vi.fn(),
    }

    await expect(assertRouteDataHealthy(page, '/')).rejects.toThrow(/handled data error/i)
    expect(page.waitForFunction).toHaveBeenCalledOnce()
  })

  it('requires representative route content after a clean data load', async () => {
    const page = {
      evaluate: vi.fn().mockResolvedValue({ alertText: '', hasExpectedContent: true }),
      waitForFunction: vi.fn(),
    }

    await expect(assertRouteDataHealthy(page, '/#/songs/39-music')).resolves.toBeUndefined()
  })

  it('requires Pages preview UI to be read-only without submission controls or Turnstile', async () => {
    const healthyPage = {
      evaluate: vi.fn().mockResolvedValue({
        hasReadOnlyLabel: true,
        hasOauthControl: false,
        hasSubmissionButton: false,
        hasTurnstile: false,
      }),
    }
    await expect(assertPreviewReadOnly(healthyPage)).resolves.toBeUndefined()

    const writablePage = {
      evaluate: vi.fn().mockResolvedValue({
        hasReadOnlyLabel: false,
        hasOauthControl: true,
        hasSubmissionButton: true,
        hasTurnstile: true,
      }),
    }
    await expect(assertPreviewReadOnly(writablePage)).rejects.toThrow(/not read-only/i)
  })

  it('records console diagnostics without treating them as promotion failures', () => {
    expect(() => assertNoBrowserSecurityErrors({
      consoleErrors: ['recoverable third-party diagnostic'],
      cspViolations: [],
      pageErrors: [],
    })).not.toThrow()
  })

  it('includes console diagnostics in the CLI report', () => {
    const report = formatPreviewSmokeReport({
      callbackUrl: 'https://app.example/api/auth/github/callback',
      consoleDiagnostics: [{ type: 'warning', text: 'third-party warning' }],
      releaseId: 'a'.repeat(40),
      routes: BROWSER_SMOKE_ROUTES,
      surfaceLabel: 'Production',
      surfaceOrigin: 'https://miku.sekai.today',
    })

    expect(report).toContain('console diagnostics: 1')
    expect(report).toContain('[warning] third-party warning')
    expect(report).toContain('production: https://miku.sekai.today')
  })

  it('accepts a 200 navigation that stays on the requested custom origin', () => {
    const response = {
      status: () => 200,
      url: () => 'https://miku.sekai.today/',
    }

    expect(() => assertSurfaceNavigation(
      response,
      'https://miku.sekai.today/#/events',
      'https://miku.sekai.today',
      'Production route /#/events',
    )).not.toThrow()
  })

  it('accepts a same-document hash navigation without an HTTP response', () => {
    expect(() => assertSurfaceNavigation(
      null,
      'https://miku.sekai.today/#/songs/39-music',
      'https://miku.sekai.today',
      'Production route /#/songs/39-music',
      { requireResponse: false },
    )).not.toThrow()
  })

  it('still requires an HTTP response for the initial document navigation', () => {
    expect(() => assertSurfaceNavigation(
      null,
      'https://miku.sekai.today/',
      'https://miku.sekai.today',
      'Production root',
    )).toThrow(/did not return a navigation response/i)
  })

  it.each([
    ['a JavaScript chunk served as HTML', assetResponse(
      'https://miku.sekai.today/assets/CatalogPage-old.js',
      200,
      'text/html; charset=utf-8',
    )],
    ['a missing stylesheet', assetResponse(
      'https://miku.sekai.today/assets/index-old.css',
      404,
      'text/html; charset=utf-8',
    )],
  ])('reports %s before a semantic bootstrap timeout', (_label, response) => {
    expect(appAssetFailure(response, 'https://miku.sekai.today'))
      .toMatch(/HTTP (?:200|404).*content-type text\/html/i)
  })

  it('accepts correctly typed app assets and ignores third-party scripts', () => {
    expect(appAssetFailure(assetResponse(
      'https://miku.sekai.today/assets/index.js',
      200,
      'text/javascript; charset=utf-8',
    ), 'https://miku.sekai.today')).toBe('')
    expect(appAssetFailure(assetResponse(
      'https://miku.sekai.today/assets/index.js',
      304,
      '',
    ), 'https://miku.sekai.today')).toBe('')
    expect(appAssetFailure(assetResponse(
      'https://www.youtube.com/iframe_api',
      200,
      'application/javascript',
    ), 'https://miku.sekai.today')).toBe('')
  })

  it('requires one public Cloudflare module beacon plus successful exact script and RUM traffic in production', () => {
    expect(() => assertCloudflareWebAnalyticsContract({
      isPreview: false,
      observations: [
        analyticsObservation({
          kind: 'cloudflare-beacon',
          method: 'GET',
          responseUrl: cloudflareBeaconUrl,
          status: 200,
          url: cloudflareBeaconUrl,
        }),
        analyticsObservation(),
      ],
      scripts: [cloudflareBeaconScript()],
      surfaceOrigin: 'https://miku.sekai.today',
    })).not.toThrow()
  })

  it.each([
    ['a missing beacon element', []],
    ['duplicate beacon elements', [cloudflareBeaconScript(), cloudflareBeaconScript()]],
    ['a non-module beacon element', [cloudflareBeaconScript({ type: 'text/javascript' })]],
    ['a beacon without public configuration', [cloudflareBeaconScript({ dataCfBeacon: '' })]],
    ...[
      ['array', ['a'.repeat(32)]],
      ['nested array', [['a'.repeat(32)]]],
      ['object', { value: 'a'.repeat(32) }],
      ['number', 123],
      ['boolean', true],
      ['null', null],
    ].map(([type, token]) => [
      `a non-string ${type} token`,
      [cloudflareBeaconScript({ dataCfBeacon: JSON.stringify({ token }) })],
    ]),
  ])('rejects production with %s', (_label, scripts) => {
    expect(() => assertCloudflareWebAnalyticsContract({
      isPreview: false,
      observations: [
        analyticsObservation({
          kind: 'cloudflare-beacon',
          method: 'GET',
          responseUrl: cloudflareBeaconUrl,
          status: 200,
          url: cloudflareBeaconUrl,
        }),
        analyticsObservation(),
      ],
      scripts,
      surfaceOrigin: 'https://miku.sekai.today',
    })).toThrow(/Cloudflare Web Analytics contract/i)
  })

  it.each([
    ['a wrong Cloudflare RUM endpoint', analyticsObservation({
      kind: 'cloudflare-rum-invalid',
      responseUrl: 'https://cloudflareinsights.com/cdn-cgi/not-rum',
      url: 'https://cloudflareinsights.com/cdn-cgi/not-rum',
    })],
    ['a failed RUM POST', analyticsObservation({ status: 503 })],
    ['a CORS/network failed RUM POST', analyticsObservation({
      failure: 'net::ERR_FAILED (CORS policy)',
      status: undefined,
    })],
  ])('rejects production with %s', (_label, rumObservation) => {
    expect(() => assertCloudflareWebAnalyticsContract({
      isPreview: false,
      observations: [
        analyticsObservation({
          kind: 'cloudflare-beacon',
          method: 'GET',
          responseUrl: cloudflareBeaconUrl,
          status: 200,
          url: cloudflareBeaconUrl,
        }),
        rumObservation,
      ],
      scripts: [cloudflareBeaconScript()],
      surfaceOrigin: 'https://miku.sekai.today',
    })).toThrow(/Cloudflare Web Analytics contract/i)
  })

  it('rejects any Cloudflare analytics script or request attempt on preview, including failures', () => {
    expect(() => assertCloudflareWebAnalyticsContract({
      isPreview: true,
      observations: [analyticsObservation({
        failure: 'net::ERR_BLOCKED_BY_CLIENT',
        kind: 'cloudflare-beacon',
        method: 'GET',
        responseUrl: '',
        status: undefined,
        url: cloudflareBeaconUrl,
      })],
      scripts: [],
      surfaceOrigin: 'https://preview-123.miku-call-guide-app.pages.dev',
    })).toThrow(/Preview must not attempt Cloudflare Web Analytics/i)
  })

  it.each([
    ['a Google Analytics host', 'https://www.google-analytics.com/g/collect?v=2'],
    ['a Google Tag Manager host', 'https://www.googletagmanager.com/gtag/js?id=G-OLD'],
    ['the retired first-party Google Tag Gateway', 'https://miku.sekai.today/825i/ga/g/c'],
  ])('classifies obsolete analytics activity from %s', (_label, url) => {
    expect(classifyAnalyticsRequest({ method: 'POST', url }, 'https://miku.sekai.today'))
      .toMatchObject({ kind: 'obsolete-google' })
    expect(() => assertCloudflareWebAnalyticsContract({
      isPreview: false,
      observations: [{
        failure: '',
        kind: 'obsolete-google',
        method: 'POST',
        responseUrl: url,
        status: 204,
        url,
      }],
      scripts: [cloudflareBeaconScript()],
      surfaceOrigin: 'https://miku.sekai.today',
    })).toThrow(/obsolete Google or Tag Gateway analytics activity/i)
  })

  it('classifies only an initial HTTP 404 as Pages deployment propagation', () => {
    expect(initialDocumentDeliveryFailure({ status: () => 404 }, 'Preview route /'))
      .toMatch(/HTTP 404.*propagating/i)
  })

  it.each([200, 301, 403, 500, 503, 524])('does not retry an initial HTTP %s response', (status) => {
    expect(initialDocumentDeliveryFailure({ status: () => status }, 'Preview route /'))
      .toBe('')
  })

  it('classifies a missing release marker as deployment propagation', () => {
    expect(deploymentHttpStatusFailure(404, 'Preview release marker'))
      .toMatch(/release marker.*HTTP 404.*propagating/i)
  })

  it('retries only identified Pages asset propagation failures', async () => {
    const run = vi.fn()
      .mockRejectedValueOnce(new BrowserDeploymentPropagationError('chunk is propagating'))
      .mockResolvedValue({ routes: BROWSER_SMOKE_ROUTES })
    const waitImpl = vi.fn()

    await expect(withDeploymentPropagationRetry(run, {
      attempts: 2,
      retryDelayMs: 5_000,
      waitImpl,
    })).resolves.toEqual({ routes: BROWSER_SMOKE_ROUTES })
    expect(run).toHaveBeenCalledTimes(2)
    expect(waitImpl).toHaveBeenCalledExactlyOnceWith(5_000)
  })

  it('does not retry CSP, semantic, or application failures', async () => {
    const failure = new Error('CSP violation')
    const run = vi.fn().mockRejectedValue(failure)

    await expect(withDeploymentPropagationRetry(run, { attempts: 8 }))
      .rejects.toBe(failure)
    expect(run).toHaveBeenCalledOnce()
  })

  it('enforces a real 120-second browser propagation deadline', async () => {
    vi.useFakeTimers()
    try {
      const run = vi.fn(() => new Promise(() => {}))
      const result = withDeploymentPropagationRetry(run, {
        attempts: 25,
        deadlineMs: 120_000,
        retryDelayMs: 5_000,
      })
      const rejection = expect(result).rejects.toThrow(/120000ms deadline/i)

      await vi.advanceTimersByTimeAsync(120_000)
      await rejection
      expect(run).toHaveBeenCalledOnce()
    } finally {
      vi.useRealTimers()
    }
  })

  it.each([
    ['a redirect response', { status: () => 308, url: () => 'https://miku.sekai.today/' }, 'https://miku.sekai.today/', /HTTP 308/i],
    ['a response on another origin', { status: () => 200, url: () => 'https://miku-call-guide-app.pages.dev/' }, 'https://miku-call-guide-app.pages.dev/', /left requested origin/i],
    ['a client-side origin change', { status: () => 200, url: () => 'https://miku.sekai.today/' }, 'https://miku-call-guide-app.pages.dev/', /left requested origin/i],
  ])('rejects %s', (_label, response, pageUrl, expected) => {
    expect(() => assertSurfaceNavigation(
      response,
      pageUrl,
      'https://miku.sekai.today',
      'Production root',
    )).toThrow(expected)
  })

  it.each([
    ['CSP violations', {
      consoleErrors: [],
      cspViolations: [{ blockedURI: 'https://static.cloudflareinsights.com/beacon.min.js' }],
      pageErrors: [],
    }],
    ['page errors', {
      consoleErrors: [],
      cspViolations: [],
      pageErrors: ['Uncaught Error: render failed'],
    }],
  ])('blocks promotion for %s', (_label, diagnostics) => {
    expect(() => assertNoBrowserSecurityErrors(diagnostics)).toThrow(/browser smoke/i)
  })
})
