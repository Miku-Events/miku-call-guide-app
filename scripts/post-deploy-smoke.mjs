import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { canonicalProductionOrigin } from '../functions/_lib/productionHostname.js'
import {
  CLOUDFLARE_WEB_ANALYTICS_COLLECTOR_ORIGIN,
  CLOUDFLARE_WEB_ANALYTICS_SCRIPT_ORIGIN,
  GOOGLE_TAG_GATEWAY_COLLECTOR_ORIGIN,
  GOOGLE_TAG_GATEWAY_SCRIPT_HASHES,
  GOOGLE_TAG_GATEWAY_SCRIPT_ORIGIN,
  TURNSTILE_ORIGIN,
  X_ORIGINS,
  YOUTUBE_FRAME_ORIGINS,
  YOUTUBE_SCRIPT_ORIGINS,
} from './static-csp-sources.mjs'

const DEFAULT_SMOKE_ATTEMPTS = 8
const DEFAULT_SMOKE_RETRY_DELAY_MS = 5_000
const DEFAULT_TIMEOUT_MS = 8_000
const MINIMUM_HSTS_MAX_AGE_SECONDS = 31_536_000
const MINIMUM_OG_IMAGE_BYTES = 10_000
const EXPECTED_PERMISSIONS_POLICY = 'camera=(), microphone=(), geolocation=()'
const EXPECTED_REFERRER_POLICY = 'strict-origin-when-cross-origin'
export const READINESS_CONTRACT_HEADER = 'x-miku-readiness-contract'
export const READINESS_CONTRACT_VERSION = 'runtime-config-v1'
const IMMUTABLE_DEPLOYMENT_ORIGIN_PATTERN = (
  /^https:\/\/[0-9a-f]{8}\.miku-call-guide-app\.pages\.dev$/
)
const STATIC_SCRIPT_ALLOWLIST = new Set([
  "'self'",
  TURNSTILE_ORIGIN,
  CLOUDFLARE_WEB_ANALYTICS_SCRIPT_ORIGIN,
  GOOGLE_TAG_GATEWAY_SCRIPT_ORIGIN,
  ...GOOGLE_TAG_GATEWAY_SCRIPT_HASHES,
  ...YOUTUBE_SCRIPT_ORIGINS,
  ...X_ORIGINS,
])
const FUNCTION_CSP = Object.freeze({
  'base-uri': ["'none'"],
  'default-src': ["'none'"],
  'frame-ancestors': ["'none'"],
})
const ALLOWED_EXTRA_CSP_DIRECTIVES = new Set([
  'block-all-mixed-content',
  'upgrade-insecure-requests',
])

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

function requiredUrl(value, name, { originOnly = false } = {}) {
  if (!value) throw new Error(`${name} is required`)
  let parsed
  try {
    parsed = new URL(value)
  } catch {
    throw new Error(`${name} must be an absolute HTTPS URL`)
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) {
    throw new Error(`${name} must be an absolute HTTPS URL`)
  }
  if (originOnly && (parsed.pathname !== '/' || parsed.search || parsed.hash)) {
    throw new Error(`${name} must contain only an HTTPS origin`)
  }
  return originOnly ? parsed.origin : parsed.href
}

function requiredReleaseId(value) {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.length > 128
    || value !== value.trim()
    || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value)
  ) {
    throw new Error('EXPECTED_RELEASE_ID is required and must be a public release identifier')
  }
  return value
}

function requiredAppOrigin(value, name) {
  requiredUrl(value, name, { originOnly: true })
  const origin = canonicalProductionOrigin(value)
  if (!origin) {
    throw new Error(`${name} must be an exact canonical HTTPS origin`)
  }
  return origin
}

function requiredDeploymentOrigin(value, appOrigin) {
  const origin = requiredUrl(value, 'DEPLOYMENT_SMOKE_ORIGIN', { originOnly: true })
  if (origin === appOrigin) {
    throw new Error('DEPLOYMENT_SMOKE_ORIGIN must differ from APP_SMOKE_ORIGIN')
  }
  if (value !== origin || !IMMUTABLE_DEPLOYMENT_ORIGIN_PATTERN.test(value)) {
    throw new Error(
      'DEPLOYMENT_SMOKE_ORIGIN must be an immutable Cloudflare deployment URL',
    )
  }
  return origin
}

export async function fetchWithTimeout(url, {
  fetchImpl = globalThis.fetch,
  headers,
  redirect = 'follow',
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('A fetch implementation is required')
  const controller = new AbortController()
  const requestHeaders = new Headers(headers)
  requestHeaders.set('accept', '*/*')
  requestHeaders.set('cache-control', 'no-cache')
  const timeout = setTimeout(() => {
    controller.abort(new Error(`Request timed out after ${timeoutMs}ms`))
  }, timeoutMs)
  try {
    return await fetchImpl(url, {
      headers: requestHeaders,
      redirect,
      signal: controller.signal,
    })
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(`Request to ${url} failed: ${detail}`)
  } finally {
    clearTimeout(timeout)
  }
}

async function withPropagationRetry(check, { attempts, retryDelayMs }) {
  if (!Number.isSafeInteger(attempts) || attempts < 1) {
    throw new Error('attempts must be at least 1')
  }
  let lastError
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await check()
    } catch (error) {
      lastError = error
    }
    if (attempt < attempts && retryDelayMs > 0) {
      await wait(retryDelayMs)
    }
  }
  throw lastError
}

function assertStatus(response, expected, label) {
  if (!expected.includes(response.status)) {
    throw new Error(`${label} returned HTTP ${response.status}; expected ${expected.join(' or ')}`)
  }
}

function parseCsp(value, label) {
  if (!value) throw new Error(`${label} is missing content-security-policy`)
  const directives = new Map()
  for (const segment of value.split(';')) {
    const tokens = segment.trim().split(/\s+/).filter(Boolean)
    if (tokens.length === 0) continue
    const name = tokens.shift().toLowerCase()
    if (directives.has(name)) {
      throw new Error(`${label} content-security-policy contains duplicate ${name}`)
    }
    if (tokens.some((token) => token.includes('*'))) {
      throw new Error(`${label} content-security-policy contains a wildcard source`)
    }
    if (tokens.some((token) => token.toLowerCase() === "'unsafe-eval'")) {
      throw new Error(`${label} content-security-policy must not contain unsafe-eval`)
    }
    const normalizedSources = tokens.map((token) => token.toLowerCase())
    if (new Set(normalizedSources).size !== normalizedSources.length) {
      throw new Error(`${label} content-security-policy contains a duplicate source in ${name}`)
    }
    directives.set(name, tokens)
  }
  return directives
}

function sameValues(actual, expected) {
  const actualValues = new Set(actual)
  const expectedValues = new Set(expected)
  return actualValues.size === expectedValues.size
    && [...actualValues].every((value) => expectedValues.has(value))
}

function assertAllowedCspDirectives(csp, requiredDirectives, label) {
  const required = new Set(requiredDirectives)
  for (const [directive, values] of csp) {
    if (required.has(directive)) continue
    if (!ALLOWED_EXTRA_CSP_DIRECTIVES.has(directive) || values.length !== 0) {
      throw new Error(
        `${label} content-security-policy contains unexpected directive ${directive}`,
      )
    }
  }
}

function unique(values) {
  return [...new Set(values.filter(Boolean))]
}

function assertStaticCsp(csp, label, { appOrigin, dataOrigin, submissionOrigin }) {
  const expectedDirectives = new Map([
    ['default-src', ["'self'"]],
    ['base-uri', ["'self'"]],
    ['object-src', ["'none'"]],
    ['frame-ancestors', ["'none'"]],
    ['connect-src', unique([
      "'self'",
      dataOrigin,
      submissionOrigin,
      TURNSTILE_ORIGIN,
      CLOUDFLARE_WEB_ANALYTICS_COLLECTOR_ORIGIN,
      GOOGLE_TAG_GATEWAY_COLLECTOR_ORIGIN,
      ...YOUTUBE_FRAME_ORIGINS,
      ...X_ORIGINS,
    ])],
    ['script-src', [...STATIC_SCRIPT_ALLOWLIST]],
    ['style-src', ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com']],
    ['font-src', ["'self'", 'https://fonts.gstatic.com']],
    ['img-src', [
      "'self'",
      'data:',
      'blob:',
      'https://i.ytimg.com',
      'https://img.youtube.com',
      'https://pbs.twimg.com',
      'https://abs.twimg.com',
    ]],
    ['frame-src', [TURNSTILE_ORIGIN, ...YOUTUBE_FRAME_ORIGINS, ...X_ORIGINS]],
    ['form-action', ["'self'", appOrigin]],
    ['manifest-src', ["'self'"]],
  ])

  assertAllowedCspDirectives(csp, expectedDirectives.keys(), label)
  for (const [directive, expected] of expectedDirectives) {
    const actual = csp.get(directive)
    if (!actual) {
      throw new Error(`${label} content-security-policy is missing ${directive}`)
    }
    if (!sameValues(actual, expected)) {
      throw new Error(`${label} content-security-policy ${directive} is outside the allowlist`)
    }
  }
}

function assertFunctionCsp(csp, label) {
  assertAllowedCspDirectives(csp, Object.keys(FUNCTION_CSP), label)
  if (Object.entries(FUNCTION_CSP).some(([directive, expected]) => (
    !csp.has(directive) || !sameValues(csp.get(directive), expected)
  ))) {
    throw new Error(`${label} content-security-policy does not match the Function allowlist`)
  }
}

function assertSecurityHeaders(headers, label, profile, cspContext) {
  if (headers.has('content-security-policy-report-only')) {
    throw new Error(`${label} must not include content-security-policy-report-only`)
  }
  const csp = parseCsp(headers.get('content-security-policy') || '', label)
  if (profile === 'static') assertStaticCsp(csp, label, cspContext)
  else assertFunctionCsp(csp, label)

  const hsts = headers.get('strict-transport-security') || ''
  const maxAge = hsts.match(/(?:^|;)\s*max-age=(\d+)(?:;|$)/i)
  if (!maxAge || Number(maxAge[1]) < MINIMUM_HSTS_MAX_AGE_SECONDS) {
    throw new Error(`${label} is missing a meaningful strict-transport-security header`)
  }
  if ((headers.get('x-content-type-options') || '').toLowerCase() !== 'nosniff') {
    throw new Error(`${label} is missing x-content-type-options: nosniff`)
  }
  if ((headers.get('referrer-policy') || '').toLowerCase() !== EXPECTED_REFERRER_POLICY) {
    throw new Error(`${label} is missing referrer-policy: ${EXPECTED_REFERRER_POLICY}`)
  }
  if ((headers.get('permissions-policy') || '') !== EXPECTED_PERMISSIONS_POLICY) {
    throw new Error(`${label} is missing permissions-policy: ${EXPECTED_PERMISSIONS_POLICY}`)
  }
}

export function assertStaticSecurityHeaders(headers, cspContext, label = 'Static response') {
  assertSecurityHeaders(headers, label, 'static', cspContext)
}

export function assertFunctionSecurityHeaders(headers, label = 'Function response') {
  assertSecurityHeaders(headers, label, 'function')
}

function extractAttribute(tag, name) {
  const expression = new RegExp(
    `(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`,
    'i',
  )
  const match = tag.match(expression)
  return match ? (match[1] ?? match[2] ?? match[3] ?? '') : ''
}

function extractCanonical(html) {
  for (const [tag] of html.matchAll(/<link\b[^>]*>/gi)) {
    const rel = extractAttribute(tag, 'rel').toLowerCase().split(/\s+/)
    if (rel.includes('canonical')) return extractAttribute(tag, 'href')
  }
  return ''
}

function extractStaticAssets(html, origin, label) {
  const references = []
  for (const [tag] of html.matchAll(/<script\b[^>]*>/gi)) {
    if (extractAttribute(tag, 'type').toLowerCase() !== 'module') continue
    const source = extractAttribute(tag, 'src')
    if (source) references.push({ kind: 'JavaScript', reference: source })
  }
  for (const [tag] of html.matchAll(/<link\b[^>]*>/gi)) {
    const rel = extractAttribute(tag, 'rel').toLowerCase().split(/\s+/)
    const reference = extractAttribute(tag, 'href')
    if (rel.includes('stylesheet') && reference) {
      references.push({ kind: 'CSS', reference })
    }
  }

  const assets = []
  for (const asset of references) {
    let url
    try {
      url = new URL(asset.reference, `${origin}/`)
    } catch {
      throw new Error(`${label} ${asset.kind} asset URL is invalid`)
    }
    if (url.origin !== origin) {
      if (asset.kind === 'CSS') continue
      throw new Error(`${label} module entry asset must stay on ${origin}`)
    }
    assets.push({ kind: asset.kind, url: url.href })
  }

  if (!assets.some(({ kind }) => kind === 'JavaScript')) {
    throw new Error(`${label} root is missing its module entry asset`)
  }
  if (!assets.some(({ kind }) => kind === 'CSS')) {
    throw new Error(`${label} root is missing its stylesheet asset`)
  }
  return assets
}

function assertAssetMediaType(response, asset, label) {
  const mediaType = (response.headers.get('content-type') || '').split(';', 1)[0].trim()
  const valid = asset.kind === 'CSS'
    ? mediaType.toLowerCase() === 'text/css'
    : /^(?:application|text)\/(?:java|ecma)script$/i.test(mediaType)
  if (!valid) {
    throw new Error(
      `${label} ${asset.kind} asset ${asset.url} returned ${mediaType || 'no content-type'}`,
    )
  }
}

function assertHtmlCacheControl(headers, label) {
  const directives = new Set(
    (headers.get('cache-control') || '')
      .split(',')
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
  )
  if (!directives.has('no-cache') || !directives.has('no-transform')) {
    throw new Error(`${label} must use cache-control: no-cache, no-transform`)
  }
}

async function checkStaticAssets(assets, label, requestOptions) {
  for (const asset of assets) {
    const response = await fetchWithTimeout(asset.url, requestOptions)
    assertStatus(response, [200], `${label} ${asset.kind} asset`)
    assertAssetMediaType(response, asset, label)
  }
  return assets.map(({ kind, url }) => ({ kind, url }))
}

async function checkMissingFingerprintAsset(
  origin,
  label,
  expectedReleaseId,
  requestOptions,
) {
  const url = `${origin}/assets/__missing-${encodeURIComponent(expectedReleaseId)}.js`
  const response = await fetchWithTimeout(url, requestOptions)
  assertStatus(response, [404], `${label} missing fingerprint asset`)
  return { status: response.status, url }
}

async function readJsonObject(response, label) {
  const mediaType = (response.headers.get('content-type') || '').split(';', 1)[0].trim()
  if (!/^application\/(?:json|[a-z0-9!#$&^_.+-]+\+json)$/i.test(mediaType)) {
    throw new Error(`${label} must return JSON`)
  }
  let value
  try {
    value = await response.json()
  } catch {
    throw new Error(`${label} must contain valid JSON`)
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be a JSON object`)
  }
  return value
}

function validateManifest(value) {
  if (value.schemaVersion !== 1) {
    throw new Error('Data manifest schemaVersion must be 1')
  }
  if (typeof value.dataVersion !== 'string' || value.dataVersion.trim() === '') {
    throw new Error('Data manifest dataVersion must be a non-empty string')
  }
  if (
    !value.manifests
    || typeof value.manifests !== 'object'
    || typeof value.manifests.callGuide !== 'string'
    || value.manifests.callGuide.trim() === ''
    || typeof value.manifests.eventCalendar !== 'string'
    || value.manifests.eventCalendar.trim() === ''
  ) {
    throw new Error('Data manifest manifests must include callGuide and eventCalendar paths')
  }
  return value
}

async function checkReleaseMarker(origin, label, expectedReleaseId, requestOptions) {
  const url = `${origin}/release.json?release=${encodeURIComponent(expectedReleaseId)}`
  const response = await fetchWithTimeout(url, requestOptions)
  assertStatus(response, [200], `${label} release marker`)
  const marker = await readJsonObject(response, `${label} release marker`)
  if (Object.keys(marker).length !== 1 || marker.releaseId !== expectedReleaseId) {
    throw new Error(`${label} release mismatch; expected ${expectedReleaseId}`)
  }
  return marker.releaseId
}

async function assertReadyResponse(response, label) {
  assertStatus(response, [200], `${label} readiness Function`)
  assertSecurityHeaders(response.headers, `${label} readiness Function`, 'function')
  if (response.headers.get(READINESS_CONTRACT_HEADER) !== READINESS_CONTRACT_VERSION) {
    throw new Error(`${label} readiness Function is missing the runtime configuration contract`)
  }
  const body = await readJsonObject(response, `${label} readiness Function`)
  if (Object.keys(body).length !== 1 || body.ready !== true) {
    throw new Error(`${label} readiness Function returned an invalid JSON contract`)
  }
}

async function checkReadiness(origin, label, requestOptions) {
  const response = await fetchWithTimeout(`${origin}/api/ready`, requestOptions)
  await assertReadyResponse(response, label)
  return response.status
}

async function checkAppSurface(
  origin,
  label,
  canonicalUrl,
  expectedReleaseId,
  cspContext,
  requestOptions,
) {
  const rootResponse = await fetchWithTimeout(`${origin}/`, requestOptions)
  assertStatus(rootResponse, [200], `${label} root`)
  assertSecurityHeaders(rootResponse.headers, `${label} root`, 'static', cspContext)
  assertHtmlCacheControl(rootResponse.headers, `${label} root`)
  const html = await rootResponse.text()
  const canonical = extractCanonical(html)
  let parsedCanonical
  try {
    parsedCanonical = new URL(canonical)
  } catch {
    throw new Error(`${label} root canonical must be an absolute URL`)
  }
  if (parsedCanonical.href !== canonicalUrl) {
    throw new Error(`${label} root canonical must equal ${canonicalUrl}; received ${parsedCanonical.href}`)
  }
  const assets = await checkStaticAssets(
    extractStaticAssets(html, origin, label),
    label,
    requestOptions,
  )
  const missingAsset = await checkMissingFingerprintAsset(
    origin,
    label,
    expectedReleaseId,
    requestOptions,
  )

  const releaseId = await checkReleaseMarker(
    origin,
    label,
    expectedReleaseId,
    requestOptions,
  )
  const readiness = await checkReadiness(origin, label, requestOptions)
  return {
    assets,
    canonical: parsedCanonical.href,
    missingAsset,
    readiness,
    releaseId,
    status: rootResponse.status,
  }
}

export async function runPostDeploySmoke({
  appOrigin,
  dataManifestUrl,
  deploymentOrigin,
  expectedReleaseId,
  submissionApiUrl,
  fetchImpl = globalThis.fetch,
  attempts = DEFAULT_SMOKE_ATTEMPTS,
  retryDelayMs = DEFAULT_SMOKE_RETRY_DELAY_MS,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  const normalizedOrigin = requiredAppOrigin(appOrigin, 'APP_SMOKE_ORIGIN')
  const normalizedDeploymentOrigin = requiredDeploymentOrigin(
    deploymentOrigin,
    normalizedOrigin,
  )
  const normalizedManifestUrl = requiredUrl(dataManifestUrl, 'DATA_MANIFEST_URL')
  const normalizedSubmissionUrl = submissionApiUrl
    ? requiredUrl(submissionApiUrl, 'SUBMISSION_API_URL')
    : ''
  const normalizedReleaseId = requiredReleaseId(expectedReleaseId)
  const canonicalUrl = `${normalizedOrigin}/`
  const requestOptions = { fetchImpl, timeoutMs }
  const surfaceRequestOptions = { ...requestOptions, redirect: 'manual' }
  const retryOptions = { attempts, retryDelayMs }
  const cspContext = {
    appOrigin: normalizedOrigin,
    dataOrigin: new URL(normalizedManifestUrl).origin,
    submissionOrigin: normalizedSubmissionUrl ? new URL(normalizedSubmissionUrl).origin : '',
  }

  const deployment = await withPropagationRetry(() => checkAppSurface(
    normalizedDeploymentOrigin,
    'Deployment',
    canonicalUrl,
    normalizedReleaseId,
    cspContext,
    surfaceRequestOptions,
  ), retryOptions)
  const app = await withPropagationRetry(() => checkAppSurface(
    normalizedOrigin,
    'Configured app',
    canonicalUrl,
    normalizedReleaseId,
    cspContext,
    surfaceRequestOptions,
  ), retryOptions)

  const ogImage = await withPropagationRetry(async () => {
    const response = await fetchWithTimeout(
      `${normalizedOrigin}/og-image.png`,
      surfaceRequestOptions,
    )
    assertStatus(response, [200], 'OG image')
    const imageType = (response.headers.get('content-type') || '').toLowerCase()
    if (!imageType.startsWith('image/')) throw new Error('OG image must return an image content-type')
    const bytes = (await response.arrayBuffer()).byteLength
    if (bytes < MINIMUM_OG_IMAGE_BYTES) {
      throw new Error(`OG image is too small (${bytes} bytes; expected at least ${MINIMUM_OG_IMAGE_BYTES})`)
    }
    return { bytes, status: response.status }
  }, retryOptions)

  const data = await withPropagationRetry(async () => {
    const response = await fetchWithTimeout(normalizedManifestUrl, requestOptions)
    assertStatus(response, [200], 'Data manifest')
    const manifest = validateManifest(await readJsonObject(response, 'Data manifest'))
    return { manifest, status: response.status }
  }, retryOptions)

  return {
    app: {
      assets: app.assets,
      canonical: app.canonical,
      missingAsset: app.missingAsset,
      releaseId: app.releaseId,
      status: app.status,
    },
    data: {
      dataVersion: data.manifest.dataVersion,
      schemaVersion: data.manifest.schemaVersion,
      status: data.status,
    },
    deployment: {
      assets: deployment.assets,
      origin: normalizedDeploymentOrigin,
      missingAsset: deployment.missingAsset,
      releaseId: deployment.releaseId,
      status: deployment.status,
    },
    readiness: {
      app: app.readiness,
      deployment: deployment.readiness,
    },
    ogImage,
  }
}

export function formatSmokeReport(report) {
  return [
    'Post-deploy smoke: PASS',
    `- deployment: HTTP ${report.deployment.status}, release ${report.deployment.releaseId}, ${report.deployment.origin}`,
    `- configured app: HTTP ${report.app.status}, release ${report.app.releaseId}, ${report.app.canonical}`,
    `- static assets: deployment ${report.deployment.assets.length}, configured app ${report.app.assets.length}`,
    `- missing asset guards: deployment HTTP ${report.deployment.missingAsset.status}, configured app HTTP ${report.app.missingAsset.status}`,
    `- readiness: deployment HTTP ${report.readiness.deployment}, configured app HTTP ${report.readiness.app}`,
    `- OG image: HTTP ${report.ogImage.status}, ${report.ogImage.bytes} bytes`,
    `- data manifest: HTTP ${report.data.status}, schema ${report.data.schemaVersion}, version ${report.data.dataVersion}`,
  ].join('\n')
}

async function runCli() {
  const report = await runPostDeploySmoke({
    appOrigin: process.env.APP_SMOKE_ORIGIN,
    dataManifestUrl: process.env.DATA_MANIFEST_URL,
    deploymentOrigin: process.env.DEPLOYMENT_SMOKE_ORIGIN,
    expectedReleaseId: process.env.EXPECTED_RELEASE_ID,
    submissionApiUrl: process.env.SUBMISSION_API_URL,
  })
  process.stdout.write(`${formatSmokeReport(report)}\n`)
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : ''
if (invokedPath === import.meta.url) {
  runCli().catch((error) => {
    process.stderr.write(`Post-deploy smoke: FAIL\n${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}
