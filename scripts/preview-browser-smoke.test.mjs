import { describe, expect, it, vi } from 'vitest'
import {
  acknowledgeInitialSpoilerDisclaimer,
  appAssetFailure,
  assertNoBrowserSecurityErrors,
  assertSurfaceNavigation,
  BrowserDeploymentPropagationError,
  BROWSER_SMOKE_ROUTES,
  deploymentHttpStatusFailure,
  formatPreviewSmokeReport,
  initialDocumentDeliveryFailure,
  mainLandmarkLocator,
  missingTagGatewayPolicySources,
  PREVIEW_ROUTES,
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
    expect(PREVIEW_ROUTES).toEqual(['/', '/#/events', '/#/songs/39-music'])
    expect(BROWSER_SMOKE_ROUTES).toBe(PREVIEW_ROUTES)
  })

  it('locates the visible semantic main landmark instead of a main element tag', () => {
    const landmark = { waitFor: vi.fn() }
    const getByRole = vi.fn(() => landmark)

    expect(mainLandmarkLocator({ getByRole })).toBe(landmark)
    expect(getByRole).toHaveBeenCalledWith('main')
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
      routes: PREVIEW_ROUTES,
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
      'https://www.googletagmanager.com/gtag/js',
      200,
      'application/javascript',
    ), 'https://miku.sekai.today')).toBe('')
  })

  it.each([404, 500, 503, 524])(
    'classifies an initial HTTP %s as Pages deployment propagation',
    (status) => {
      expect(initialDocumentDeliveryFailure({ status: () => status }, 'Preview route /'))
        .toMatch(new RegExp(`HTTP ${status}.*propagating`, 'i'))
    },
  )

  it.each([200, 301, 403])('does not retry an initial HTTP %s response', (status) => {
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

  it('identifies only missing deployed Google Tag Gateway CSP sources', () => {
    const complete = new Headers({
      'content-security-policy': [
        "connect-src 'self' https://www.google-analytics.com",
        "script-src 'self' https://www.googletagmanager.com 'sha256-hVajfYfCCiKE0tyiHJsO6QZ7neDSGvNU29XVzmGcyAU=' 'sha256-UxvldURLmbwK98B86I+nlncBxT8RepUWLzN0DTl03tk='",
      ].join('; '),
    })
    const stale = new Headers({
      'content-security-policy': "connect-src 'self'; script-src 'self'",
    })

    expect(missingTagGatewayPolicySources(complete)).toEqual([])
    expect(missingTagGatewayPolicySources(stale)).toEqual([
      'https://www.google-analytics.com',
      'https://www.googletagmanager.com',
      "'sha256-hVajfYfCCiKE0tyiHJsO6QZ7neDSGvNU29XVzmGcyAU='",
      "'sha256-UxvldURLmbwK98B86I+nlncBxT8RepUWLzN0DTl03tk='",
    ])
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
