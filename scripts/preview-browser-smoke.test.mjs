import { describe, expect, it } from 'vitest'
import {
  assertNoBrowserSecurityErrors,
  formatPreviewSmokeReport,
  PREVIEW_ROUTES,
} from './preview-browser-smoke.mjs'

describe('preview browser smoke diagnostics', () => {
  it('visits the catalog, events, and representative song routes', () => {
    expect(PREVIEW_ROUTES).toEqual(['/', '/#/events', '/#/songs/39-music'])
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
