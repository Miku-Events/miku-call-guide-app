import { describe, expect, it } from 'vitest'
import { generateStaticHeaders } from './static-headers.mjs'

const environment = {
  APP_ENV: 'production',
  VITE_APP_ORIGIN: 'https://app.miku-events.dev',
  VITE_DATA_MANIFEST_URL: 'https://data.miku-events.dev/releases/current/manifest.json',
  VITE_SUBMISSION_API_URL: 'https://api.miku-events.dev/v1',
}

function directive(headers, name) {
  const cspLine = headers
    .split('\n')
    .find((line) => line.trimStart().startsWith('Content-Security-Policy:'))
  const separator = cspLine?.indexOf(':') ?? -1
  const csp = separator >= 0 ? cspLine.slice(separator + 1).trim() : ''
  return csp
    .split(';')
    .map((value) => value.trim())
    .find((value) => value.startsWith(`${name} `)) ?? ''
}

describe('static Cloudflare Pages headers', () => {
  it('uses exact configured origins without copying URL paths', () => {
    const headers = generateStaticHeaders(environment)

    expect(headers).toContain("connect-src 'self' https://data.miku-events.dev https://api.miku-events.dev")
    expect(headers).toContain("form-action 'self' https://app.miku-events.dev")
    expect(headers).not.toContain('/releases/current/manifest.json')
    expect(headers).not.toContain('https://api.miku-events.dev/v1')
  })

  it('allows only the required finite service origins in scripts and forbids unsafe-eval', () => {
    const headers = generateStaticHeaders(environment)
    const scripts = directive(headers, 'script-src')

    expect(scripts).toContain("script-src 'self'")
    expect(scripts).toContain('https://challenges.cloudflare.com')
    expect(scripts).toContain('https://www.youtube.com')
    expect(scripts).toContain('https://platform.x.com')
    expect(scripts).not.toContain('*')
    expect(headers).not.toContain("'unsafe-eval'")
    expect(headers).toContain('https://fonts.googleapis.com')
    expect(headers).toContain('https://fonts.gstatic.com')
  })

  it('emits the required static response security headers', () => {
    const headers = generateStaticHeaders(environment)

    expect(headers).toMatch(/^\/\*\r?\n/)
    expect(headers).toContain("default-src 'self'")
    expect(headers).toContain("object-src 'none'")
    expect(headers).toContain("frame-ancestors 'none'")
    expect(headers).toContain('Strict-Transport-Security: max-age=31536000')
    expect(headers).toContain('X-Content-Type-Options: nosniff')
    expect(headers).toContain('Referrer-Policy: strict-origin-when-cross-origin')
    expect(headers).toContain('Permissions-Policy: camera=(), microphone=(), geolocation=()')
    expect(headers).toContain('Content-Security-Policy:')
    expect(headers).not.toContain('Content-Security-Policy-Report-Only:')
  })

  it('uses report-only CSP only for preview artifacts', () => {
    const headers = generateStaticHeaders({
      ...environment,
      VITE_CSP_MODE: 'preview',
    })

    expect(headers).toContain('Content-Security-Policy-Report-Only:')
    expect(headers).not.toMatch(/\n\s+Content-Security-Policy:/)
    expect(headers).toContain('Strict-Transport-Security: max-age=31536000')
    expect(headers).toContain('X-Content-Type-Options: nosniff')
    expect(headers).toContain('Referrer-Policy: strict-origin-when-cross-origin')
    expect(headers).toContain('Permissions-Policy: camera=(), microphone=(), geolocation=()')
  })

  it('prevents a stale release marker from being cached across deployments', () => {
    const headers = generateStaticHeaders(environment)

    expect(headers).toMatch(/\/release\.json\r?\n\s+Cache-Control: no-store/)
  })

  it('omits an unconfigured optional submission origin', () => {
    const headers = generateStaticHeaders({
      ...environment,
      VITE_SUBMISSION_API_URL: '',
    })

    expect(directive(headers, 'connect-src')).not.toContain('https://api.miku-events.dev')
  })

  it.each([
    ['missing app origin', { ...environment, VITE_APP_ORIGIN: '' }],
    ['missing data manifest', { ...environment, VITE_DATA_MANIFEST_URL: '' }],
    ['non-http data URL', { ...environment, VITE_DATA_MANIFEST_URL: 'file:///tmp/manifest.json' }],
    ['header injection', { ...environment, VITE_APP_ORIGIN: 'https://app.miku-events.dev\r\nX-Evil: true' }],
  ])('rejects %s', (_label, candidate) => {
    expect(() => generateStaticHeaders(candidate)).toThrow()
  })
})
