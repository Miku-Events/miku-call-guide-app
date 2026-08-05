import { describe, expect, it, vi } from 'vitest'
import {
  acknowledgeInitialSpoilerDisclaimer,
  assertNoBrowserSecurityErrors,
  formatPreviewSmokeReport,
  mainLandmarkLocator,
  PREVIEW_ROUTES,
  waitForRouteReady,
} from './preview-browser-smoke.mjs'

describe('preview browser smoke diagnostics', () => {
  it('visits the catalog, events, and representative song routes', () => {
    expect(PREVIEW_ROUTES).toEqual(['/', '/#/events', '/#/songs/39-music'])
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
      previewOrigin: 'https://preview.pages.dev',
      releaseId: 'a'.repeat(40),
      routes: PREVIEW_ROUTES,
    })

    expect(report).toContain('console diagnostics: 1')
    expect(report).toContain('[warning] third-party warning')
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
    expect(() => assertNoBrowserSecurityErrors(diagnostics)).toThrow(/preview browser smoke/i)
  })
})
