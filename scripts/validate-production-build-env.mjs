import { pathToFileURL } from 'node:url'
import { PRODUCTION_APP_ORIGIN } from '../functions/_lib/productionHostname.js'

const PRODUCTION_DATA_MANIFEST_URL = 'https://miku-call-guide-data.pages.dev/manifest.json'
const officialTurnstileTestSiteKeys = new Set([
  '1x00000000000000000000AA',
  '2x00000000000000000000AB',
  '1x00000000000000000000BB',
  '2x00000000000000000000BB',
  '3x00000000000000000000FF',
])

function requiredExact(name, value, expected) {
  if (value === undefined || value === null || value === '') {
    throw new Error(`${name} is required`)
  }
  if (value !== expected) {
    throw new Error(`${name} must equal ${expected}`)
  }
  return value
}

export function validateProductionBuildEnv(environment) {
  const appOrigin = requiredExact(
    'VITE_APP_ORIGIN',
    environment.appOrigin,
    PRODUCTION_APP_ORIGIN,
  )
  const dataManifestUrl = requiredExact(
    'VITE_DATA_MANIFEST_URL',
    environment.dataManifestUrl,
    PRODUCTION_DATA_MANIFEST_URL,
  )
  const turnstileSiteKey = environment.turnstileSiteKey

  if (turnstileSiteKey === undefined || turnstileSiteKey === null || turnstileSiteKey === '') {
    throw new Error('VITE_CLOUDFLARE_TURNSTILE_SITE_KEY is required')
  }
  if (typeof turnstileSiteKey !== 'string') {
    throw new Error('VITE_CLOUDFLARE_TURNSTILE_SITE_KEY must be a string')
  }
  if (/YOUR_/i.test(turnstileSiteKey)) {
    throw new Error('VITE_CLOUDFLARE_TURNSTILE_SITE_KEY cannot contain YOUR_')
  }
  if (/\r|\n/.test(turnstileSiteKey)) {
    throw new Error('VITE_CLOUDFLARE_TURNSTILE_SITE_KEY must be a single-line value')
  }
  if (officialTurnstileTestSiteKeys.has(turnstileSiteKey)) {
    throw new Error('VITE_CLOUDFLARE_TURNSTILE_SITE_KEY cannot use an official test key')
  }
  if (!/^0x4[A-Za-z0-9]{17,29}$/.test(turnstileSiteKey)) {
    throw new Error(
      'VITE_CLOUDFLARE_TURNSTILE_SITE_KEY must be a 20-32 character ASCII token beginning with 0x4',
    )
  }

  return { appOrigin, dataManifestUrl, turnstileSiteKey }
}

const isDirectExecution = process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href

if (isDirectExecution) {
  try {
    const environment = validateProductionBuildEnv({
      appOrigin: process.env.PRODUCTION_APP_ORIGIN,
      dataManifestUrl: process.env.PRODUCTION_DATA_MANIFEST_URL,
      turnstileSiteKey: process.env.PRODUCTION_TURNSTILE_SITE_KEY,
    })
    process.stdout.write([
      `VITE_APP_ORIGIN=${environment.appOrigin}`,
      `VITE_DATA_MANIFEST_URL=${environment.dataManifestUrl}`,
      `VITE_CLOUDFLARE_TURNSTILE_SITE_KEY=${environment.turnstileSiteKey}`,
      '',
    ].join('\n'))
  } catch (error) {
    const message = error instanceof Error
      ? error.message
      : 'Production build environment is invalid'
    process.stderr.write(`${message}\n`)
    process.exitCode = 1
  }
}
