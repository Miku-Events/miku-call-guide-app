import { describe, expect, it } from 'vitest'
import { assertNoBrowserSecurityErrors } from './preview-browser-smoke.mjs'

describe('preview browser smoke diagnostics', () => {
  it('accepts a browser run without CSP, console, or page errors', () => {
    expect(() => assertNoBrowserSecurityErrors({
      consoleErrors: [],
      cspViolations: [],
      pageErrors: [],
    })).not.toThrow()
  })

  it.each([
    ['CSP violations', {
      consoleErrors: [],
      cspViolations: [{ blockedURI: 'https://static.cloudflareinsights.com/beacon.min.js' }],
      pageErrors: [],
    }],
    ['console errors', {
      consoleErrors: ['Refused to execute script'],
      cspViolations: [],
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
