import { describe, expect, it, vi } from 'vitest'
import {
  acknowledgeInitialSpoilerDisclaimer,
  appAssetFailure,
  assertNoBrowserSecurityErrors,
  assertPreviewReadOnly,
  assertRouteDataHealthy,
  assertSurfaceNavigation,
  BrowserDeploymentPropagationError,
  BROWSER_SMOKE_ROUTES,
  deploymentHttpStatusFailure,
  formatPreviewSmokeReport,
  initialDocumentDeliveryFailure,
  isGoogleTagGatewayMeasurementResponse,
  withDeploymentPropagationRetry,
  waitForRouteReady,
} from './preview-browser-smoke.mjs'

function assetResponse(url, status, contentType) {
  return {
    headers: () => ({ 'content-type': contentType }),
    status: () => status,
    url: () => url,
  }
}

describe('preview browser smoke diagnostics', () => {
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

  it('recognizes a successful first-party Google Tag Gateway measurement', () => {
    const response = {
      method: 'POST',
      postData: '',
      status: 204,
      url: 'https://miku.sekai.today/825i/ga/g/c?tid=G-M2VJDBEYN0',
    }

    expect(isGoogleTagGatewayMeasurementResponse(
      response,
      'https://miku.sekai.today',
    )).toBe(true)
    expect(isGoogleTagGatewayMeasurementResponse(
      { ...response, url: 'https://miku.sekai.today/825i/ga/g/c', postData: 'tid=G-M2VJDBEYN0' },
      'https://miku.sekai.today',
    )).toBe(true)
  })

  it.each([
    ['another origin', { url: 'https://www.google-analytics.com/g/s/collect?tid=G-M2VJDBEYN0' }],
    ['a non-POST request', { method: 'GET' }],
    ['a failed response', { status: 400 }],
    ['a request without the configured measurement id', { url: 'https://miku.sekai.today/825i/ga/g/c' }],
    ['an unrelated query value', { url: 'https://miku.sekai.today/825i/ga/g/c?note=G-M2VJDBEYN0' }],
  ])('rejects Google Tag Gateway activity from %s', (_label, override) => {
    expect(isGoogleTagGatewayMeasurementResponse({
      method: 'POST',
      postData: '',
      status: 204,
      url: 'https://miku.sekai.today/825i/ga/g/c?tid=G-M2VJDBEYN0',
      ...override,
    }, 'https://miku.sekai.today')).toBe(false)
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
