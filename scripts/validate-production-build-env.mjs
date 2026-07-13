import { isIP } from 'node:net'
import { pathToFileURL } from 'node:url'
import { canonicalProductionOrigin } from '../api/_production-hostname.js'

const reservedExampleHosts = ['example.com', 'example.net', 'example.org', 'example.test']
const PRODUCTION_APP_ORIGIN = 'https://miku-call-guide-app.pages.dev'
const PRODUCTION_DATA_MANIFEST_URL = 'https://miku-call-guide-data.pages.dev/manifest.json'
const officialTurnstileTestSiteKeys = new Set([
  '1x00000000000000000000AA',
  '2x00000000000000000000AB',
  '1x00000000000000000000BB',
  '2x00000000000000000000BB',
  '3x00000000000000000000FF',
])

function validateUrl(name, rawValue, optional = false) {
  const value = String(rawValue ?? '').trim()
  if (!value) {
    if (optional) {
      return ''
    }
    throw new Error(`${name} is required`)
  }

  if (/YOUR_/i.test(value)) {
    throw new Error(`${name} cannot contain YOUR_`)
  }
  if (/\r|\n/.test(value)) {
    throw new Error(`${name} must be a single-line URL`)
  }

  let url
  try {
    url = new URL(value)
  } catch {
    throw new Error(`${name} must be a valid URL`)
  }

  if (url.protocol !== 'https:') {
    throw new Error(`${name} must use HTTPS`)
  }

  const hostname = url.hostname
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '')
  const ipVersion = isIP(hostname)
  const isLocalHostname = hostname === 'localhost' || hostname.endsWith('.localhost')
  const isIpv4Loopback = ipVersion === 4 && hostname.split('.')[0] === '127'
  const isIpv6Loopback = ipVersion === 6 && hostname === '::1'
  if (isLocalHostname || isIpv4Loopback || isIpv6Loopback || hostname === '0.0.0.0') {
    throw new Error(`${name} cannot use a local or loopback host`)
  }

  if (reservedExampleHosts.some((reservedHost) => (
    hostname === reservedHost || hostname.endsWith(`.${reservedHost}`)
  ))) {
    throw new Error(`${name} cannot use an IANA reserved example host`)
  }

  return value
}

export function validateProductionBuildEnv(environment) {
  const rawAppOrigin = String(environment.appOrigin ?? '')
  const appOrigin = validateUrl(
    'VITE_APP_ORIGIN',
    rawAppOrigin,
  )
  if (
    rawAppOrigin !== appOrigin
    || canonicalProductionOrigin(appOrigin) !== appOrigin
  ) {
    throw new Error('VITE_APP_ORIGIN must be an exact canonical HTTPS origin')
  }
  if (appOrigin !== PRODUCTION_APP_ORIGIN) {
    throw new Error(`VITE_APP_ORIGIN must equal ${PRODUCTION_APP_ORIGIN}`)
  }
  const rawDataManifestUrl = String(environment.dataManifestUrl ?? '')
  const dataManifestUrl = validateUrl(
    'VITE_DATA_MANIFEST_URL',
    rawDataManifestUrl,
  )
  if (
    rawDataManifestUrl !== dataManifestUrl
    || dataManifestUrl !== PRODUCTION_DATA_MANIFEST_URL
  ) {
    throw new Error(`VITE_DATA_MANIFEST_URL must equal ${PRODUCTION_DATA_MANIFEST_URL}`)
  }
  const submissionApiUrl = validateUrl(
    'VITE_SUBMISSION_API_URL',
    environment.submissionApiUrl,
    true,
  )
  const turnstileSiteKey = String(environment.turnstileSiteKey ?? '')

  if (!turnstileSiteKey) {
    throw new Error('VITE_CLOUDFLARE_TURNSTILE_SITE_KEY is required')
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

  return { appOrigin, dataManifestUrl, submissionApiUrl, turnstileSiteKey }
}

const isDirectExecution = process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href

if (isDirectExecution) {
  try {
    const environment = validateProductionBuildEnv({
      appOrigin: process.env.PRODUCTION_APP_ORIGIN,
      dataManifestUrl: process.env.PRODUCTION_DATA_MANIFEST_URL,
      submissionApiUrl: process.env.PRODUCTION_SUBMISSION_API_URL,
      turnstileSiteKey: process.env.PRODUCTION_TURNSTILE_SITE_KEY,
    })
    const output = [
      `VITE_APP_ORIGIN=${environment.appOrigin}`,
      `VITE_DATA_MANIFEST_URL=${environment.dataManifestUrl}`,
      `VITE_CLOUDFLARE_TURNSTILE_SITE_KEY=${environment.turnstileSiteKey}`,
    ]
    if (environment.submissionApiUrl) {
      output.push(`VITE_SUBMISSION_API_URL=${environment.submissionApiUrl}`)
    }
    process.stdout.write(`${output.join('\n')}\n`)
  } catch (error) {
    const message = error instanceof Error
      ? error.message
      : 'Production build environment is invalid'
    process.stderr.write(`${message}\n`)
    process.exitCode = 1
  }
}
