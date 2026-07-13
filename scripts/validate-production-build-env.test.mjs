import { describe, expect, it } from 'vitest'
import { validateProductionBuildEnv } from './validate-production-build-env.mjs'

const validEnvironment = {
  appOrigin: 'https://miku-call-guide-app.pages.dev',
  dataManifestUrl: 'https://miku-call-guide-data.pages.dev/manifest.json',
  submissionApiUrl: 'https://miku-call-guide.pages.dev',
  turnstileSiteKey: '0x4AAAAAAABbCcDdEeFfGgHh',
}

const officialTurnstileTestSiteKeys = [
  '1x00000000000000000000AA',
  '2x00000000000000000000AB',
  '1x00000000000000000000BB',
  '2x00000000000000000000BB',
  '3x00000000000000000000FF',
]

describe('validateProductionBuildEnv', () => {
  it('rejects missing required production values', () => {
    expect(() => validateProductionBuildEnv({
      ...validEnvironment,
      dataManifestUrl: '',
    })).toThrow('VITE_DATA_MANIFEST_URL is required')

    expect(() => validateProductionBuildEnv({
      ...validEnvironment,
      appOrigin: '',
    })).toThrow('VITE_APP_ORIGIN is required')

    expect(() => validateProductionBuildEnv({
      ...validEnvironment,
      turnstileSiteKey: '',
    })).toThrow('VITE_CLOUDFLARE_TURNSTILE_SITE_KEY is required')
  })

  it.each([
    ['app origin', 'appOrigin'],
    ['data manifest', 'dataManifestUrl'],
    ['submission API', 'submissionApiUrl'],
  ])('rejects a non-HTTPS %s URL', (_label, field) => {
    expect(() => validateProductionBuildEnv({
      ...validEnvironment,
      [field]: 'http://miku-events.dev/resource',
    })).toThrow('must use HTTPS')
  })

  it.each([
    'https://localhost/manifest.json',
    'https://api.localhost/manifest.json',
    'https://127.0.0.1/manifest.json',
    'https://127.42.0.8/manifest.json',
    'https://[::1]/manifest.json',
    'https://0.0.0.0/manifest.json',
  ])('rejects local or loopback URL %s', (dataManifestUrl) => {
    expect(() => validateProductionBuildEnv({
      ...validEnvironment,
      dataManifestUrl,
    })).toThrow('cannot use a local or loopback host')
  })

  it.each([
    'https://example.com/manifest.json',
    'https://cdn.example.com/manifest.json',
    'https://example.net/manifest.json',
    'https://assets.example.net/manifest.json',
    'https://example.org/manifest.json',
    'https://api.example.org/manifest.json',
    'https://example.test/manifest.json',
    'https://data.example.test/manifest.json',
  ])('rejects IANA reserved example URL %s', (dataManifestUrl) => {
    expect(() => validateProductionBuildEnv({
      ...validEnvironment,
      dataManifestUrl,
    })).toThrow('cannot use an IANA reserved example host')
  })

  it('rejects the documented api.example.com submission placeholder', () => {
    expect(() => validateProductionBuildEnv({
      ...validEnvironment,
      submissionApiUrl: 'https://api.example.com',
    })).toThrow('VITE_SUBMISSION_API_URL cannot use an IANA reserved example host')
  })

  it('rejects YOUR_ placeholders', () => {
    expect(() => validateProductionBuildEnv({
      ...validEnvironment,
      dataManifestUrl: 'https://data.miku-events.dev/YOUR_ORG/manifest.json',
    })).toThrow('VITE_DATA_MANIFEST_URL cannot contain YOUR_')

    expect(() => validateProductionBuildEnv({
      ...validEnvironment,
      turnstileSiteKey: 'YOUR_TURNSTILE_SITE_KEY',
    })).toThrow('VITE_CLOUDFLARE_TURNSTILE_SITE_KEY cannot contain YOUR_')
  })

  it('rejects a valid HTTPS app origin other than the fixed production origin', () => {
    expect(() => validateProductionBuildEnv({
      ...validEnvironment,
      appOrigin: 'https://alternate-miku-call-guide-app.pages.dev',
    })).toThrow(
      'VITE_APP_ORIGIN must equal https://miku-call-guide-app.pages.dev',
    )
  })

  it.each([
    'https://alternate-miku-call-guide-data.pages.dev/manifest.json',
    'https://miku-call-guide-data.pages.dev/manifest.json ',
    'https://miku-call-guide-data.pages.dev/manifest.json?version=latest',
  ])('rejects data URL %s instead of the exact production manifest', (dataManifestUrl) => {
    expect(() => validateProductionBuildEnv({
      ...validEnvironment,
      dataManifestUrl,
    })).toThrow(
      'VITE_DATA_MANIFEST_URL must equal https://miku-call-guide-data.pages.dev/manifest.json',
    )
  })

  it.each([
    ['a trailing slash', 'https://miku-call-guide-app.pages.dev/'],
    ['an uppercase hostname', 'https://MIKU-CALL-GUIDE-APP.PAGES.DEV'],
    ['an explicit default HTTPS port', 'https://miku-call-guide-app.pages.dev:443'],
    ['leading whitespace', ' https://miku-call-guide-app.pages.dev'],
    ['trailing whitespace', 'https://miku-call-guide-app.pages.dev '],
    ['a path', 'https://miku-call-guide-app.pages.dev/app'],
    ['a query', 'https://miku-call-guide-app.pages.dev?source=deploy'],
    ['a fragment', 'https://miku-call-guide-app.pages.dev#app'],
    ['userinfo', 'https://user@miku-call-guide-app.pages.dev'],
  ])('rejects %s in VITE_APP_ORIGIN before building', (_label, appOrigin) => {
    expect(() => validateProductionBuildEnv({
      ...validEnvironment,
      appOrigin,
    })).toThrow('VITE_APP_ORIGIN must be an exact canonical HTTPS origin')
  })

  it.each(officialTurnstileTestSiteKeys)('rejects official Turnstile test site key %s', (turnstileSiteKey) => {
    expect(() => validateProductionBuildEnv({
      ...validEnvironment,
      turnstileSiteKey,
    })).toThrow('VITE_CLOUDFLARE_TURNSTILE_SITE_KEY cannot use an official test key')
  })

  it.each([
    ['an arbitrary value', 'invalid-key'],
    ['a value shorter than 20 characters', `0x4${'A'.repeat(16)}`],
    ['a value longer than 32 characters', `0x4${'A'.repeat(30)}`],
    ['leading whitespace', ` ${validEnvironment.turnstileSiteKey}`],
    ['trailing whitespace', `${validEnvironment.turnstileSiteKey} `],
    ['embedded whitespace', '0x4AAAAAAA BbCcDdEeFfGgHh'],
    ['punctuation', '0x4AAAAAAABbCcDdEeFfGg-Hh'],
  ])('rejects %s as a production Turnstile site key', (_label, turnstileSiteKey) => {
    expect(() => validateProductionBuildEnv({
      ...validEnvironment,
      turnstileSiteKey,
    })).toThrow(
      'VITE_CLOUDFLARE_TURNSTILE_SITE_KEY must be a 20-32 character ASCII token beginning with 0x4',
    )
  })

  it('accepts the fixed production values and an optional submission origin', () => {
    expect(validateProductionBuildEnv(validEnvironment)).toEqual(validEnvironment)
    expect(validateProductionBuildEnv({
      ...validEnvironment,
      submissionApiUrl: '',
    })).toEqual({
      ...validEnvironment,
      submissionApiUrl: '',
    })
  })
})
