import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'
import { PRODUCTION_APP_ORIGIN } from '../functions/_lib/productionHostname.js'
import { validateProductionBuildEnv } from './validate-production-build-env.mjs'

const PRODUCTION_DATA_MANIFEST_URL = 'https://miku-call-guide-data.pages.dev/manifest.json'
const executeFile = promisify(execFile)
const validEnvironment = {
  appOrigin: PRODUCTION_APP_ORIGIN,
  dataManifestUrl: PRODUCTION_DATA_MANIFEST_URL,
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
  it.each([
    ['appOrigin', 'VITE_APP_ORIGIN'],
    ['dataManifestUrl', 'VITE_DATA_MANIFEST_URL'],
    ['turnstileSiteKey', 'VITE_CLOUDFLARE_TURNSTILE_SITE_KEY'],
  ])('requires %s', (field, name) => {
    expect(() => validateProductionBuildEnv({
      ...validEnvironment,
      [field]: '',
    })).toThrow(`${name} is required`)
  })

  it.each([
    'https://alternate-miku-call-guide-app.pages.dev',
    'http://miku.sekai.today',
    ' https://miku.sekai.today',
    'https://miku.sekai.today/',
    'https://miku.sekai.today/app',
  ])('requires the exact production app origin instead of %s', (appOrigin) => {
    expect(() => validateProductionBuildEnv({
      ...validEnvironment,
      appOrigin,
    })).toThrow(`VITE_APP_ORIGIN must equal ${PRODUCTION_APP_ORIGIN}`)
  })

  it('keeps the build-time origin equal to Wrangler production APP_ORIGIN', async () => {
    const wrangler = await readFile('wrangler.toml', 'utf8')
    const productionVars = wrangler.slice(wrangler.indexOf('[env.production.vars]'))

    expect(productionVars).toContain(`APP_ORIGIN = "${PRODUCTION_APP_ORIGIN}"`)
  })

  it.each([
    'https://alternate-miku-call-guide-data.pages.dev/manifest.json',
    `${PRODUCTION_DATA_MANIFEST_URL} `,
    `${PRODUCTION_DATA_MANIFEST_URL}?version=latest`,
  ])('requires the exact production manifest instead of %s', (dataManifestUrl) => {
    expect(() => validateProductionBuildEnv({
      ...validEnvironment,
      dataManifestUrl,
    })).toThrow(`VITE_DATA_MANIFEST_URL must equal ${PRODUCTION_DATA_MANIFEST_URL}`)
  })

  it.each(officialTurnstileTestSiteKeys)(
    'rejects official Turnstile test site key %s',
    (turnstileSiteKey) => {
      expect(() => validateProductionBuildEnv({
        ...validEnvironment,
        turnstileSiteKey,
      })).toThrow('VITE_CLOUDFLARE_TURNSTILE_SITE_KEY cannot use an official test key')
    },
  )

  it.each([
    ['a non-string value', 42, 'must be a string'],
    ['a placeholder', 'YOUR_TURNSTILE_SITE_KEY', 'cannot contain YOUR_'],
    ['a line break', `${validEnvironment.turnstileSiteKey}\n`, 'must be a single-line value'],
    ['an arbitrary value', 'invalid-key', 'must be a 20-32 character ASCII token'],
    ['a short value', `0x4${'A'.repeat(16)}`, 'must be a 20-32 character ASCII token'],
    ['a long value', `0x4${'A'.repeat(30)}`, 'must be a 20-32 character ASCII token'],
    ['whitespace', ` ${validEnvironment.turnstileSiteKey}`, 'must be a 20-32 character ASCII token'],
    ['punctuation', '0x4AAAAAAABbCcDdEeFfGg-Hh', 'must be a 20-32 character ASCII token'],
  ])('rejects %s as a production Turnstile key', (_label, turnstileSiteKey, message) => {
    expect(() => validateProductionBuildEnv({
      ...validEnvironment,
      turnstileSiteKey,
    })).toThrow(message)
  })

  it('skips production configuration outside a production release', () => {
    expect(validateProductionBuildEnv({ productionRelease: false })).toBeNull()
  })

  it('validates a release without a build-time analytics token', async () => {
    const { stderr, stdout } = await executeFile(
      process.execPath,
      ['scripts/validate-production-build-env.mjs'],
      {
        env: {
          PRODUCTION_APP_ORIGIN: validEnvironment.appOrigin,
          PRODUCTION_DATA_MANIFEST_URL: validEnvironment.dataManifestUrl,
          PRODUCTION_RELEASE: 'true',
          PRODUCTION_TURNSTILE_SITE_KEY: validEnvironment.turnstileSiteKey,
        },
      },
    )

    expect(stderr).toBe('')
    expect(stdout).toContain(`VITE_APP_ORIGIN=${validEnvironment.appOrigin}`)
  })

  it('accepts the exact production configuration', () => {
    expect(validateProductionBuildEnv(validEnvironment)).toEqual(validEnvironment)
  })
})
