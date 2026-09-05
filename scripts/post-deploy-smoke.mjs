import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { canonicalProductionOrigin } from '../functions/_lib/productionHostname.js'
import {
  validateCallGuideManifest,
  validateEventCalendarIndex,
  validateEventCalendarMonth,
  validateRootManifest,
  validateRuntimeEvent,
  validateRuntimeSong,
} from '../data-contracts/validators.mjs'
import {
  CLOUDFLARE_WEB_ANALYTICS_BEACON_URL,
  CLOUDFLARE_WEB_ANALYTICS_RUM_URL,
  TURNSTILE_ORIGIN,
  X_ORIGINS,
  YOUTUBE_FRAME_ORIGINS,
  YOUTUBE_SCRIPT_ORIGINS,
} from './static-csp-sources.mjs'

const DEFAULT_SMOKE_ATTEMPTS = 25
const DEFAULT_SMOKE_RETRY_DELAY_MS = 5_000
const DEFAULT_TIMEOUT_MS = 8_000
const DEFAULT_PROPAGATION_DEADLINE_MS = 120_000
const MINIMUM_HSTS_MAX_AGE_SECONDS = 31_536_000
const MINIMUM_OG_IMAGE_BYTES = 10_000
const EXPECTED_PERMISSIONS_POLICY = 'camera=(), microphone=(), geolocation=()'
const EXPECTED_REFERRER_POLICY = 'strict-origin-when-cross-origin'
const DEPLOYMENT_PROPAGATION_ERROR_CODE = 'DEPLOYMENT_PROPAGATION'
const READINESS_CONTRACT_HEADER = 'x-miku-readiness-contract'
const READINESS_CONTRACT_VERSION = 'runtime-config-v2'
const IMMUTABLE_DEPLOYMENT_ORIGIN_PATTERN = (
  /^https:\/\/[0-9a-f]{8}\.miku-call-guide-app\.pages\.dev$/
)
const STATIC_SCRIPT_ALLOWLIST = new Set([
  "'self'",
  CLOUDFLARE_WEB_ANALYTICS_BEACON_URL,
  TURNSTILE_ORIGIN,
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

export function requiredReleaseId(value) {
  if (!value) throw new Error('EXPECTED_RELEASE_ID is required')
  if (!/^[0-9a-f]{40}$/.test(value)) {
    throw new Error('EXPECTED_RELEASE_ID must be a full lowercase commit SHA')
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
  deadlineAt,
  fetchImpl = globalThis.fetch,
  headers,
  method = 'GET',
  redirect = 'follow',
  signal,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('A fetch implementation is required')
  if (signal?.aborted) throw signal.reason
  const controller = new AbortController()
  const forwardAbort = () => controller.abort(signal?.reason)
  signal?.addEventListener('abort', forwardAbort, { once: true })
  const requestHeaders = new Headers(headers)
  requestHeaders.set('accept', '*/*')
  requestHeaders.set('cache-control', 'no-cache')
  const remainingMs = deadlineAt === undefined ? Number.POSITIVE_INFINITY : deadlineAt - Date.now()
  if (remainingMs <= 0) {
    signal?.removeEventListener('abort', forwardAbort)
    throw new Error('Deployment propagation deadline exceeded')
  }
  const effectiveTimeoutMs = Math.min(timeoutMs, remainingMs)
  const timeout = setTimeout(() => {
    controller.abort(new Error(`Request timed out after ${effectiveTimeoutMs}ms`))
  }, effectiveTimeoutMs)
  try {
    return await fetchImpl(url, {
      headers: requestHeaders,
      method,
      redirect,
      signal: controller.signal,
    })
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    const message = `Request to ${url} failed: ${detail}`
    throw new Error(message, { cause: error })
  } finally {
    clearTimeout(timeout)
    signal?.removeEventListener('abort', forwardAbort)
  }
}

export class DeploymentPropagationError extends Error {
  constructor(message, options) {
    super(message, options)
    this.name = 'DeploymentPropagationError'
    this.code = DEPLOYMENT_PROPAGATION_ERROR_CODE
  }
}

export async function withPropagationRetry(check, {
  attempts,
  deadlineAt: configuredDeadlineAt,
  deadlineMs = DEFAULT_PROPAGATION_DEADLINE_MS,
  retryDelayMs,
  waitImpl = wait,
}) {
  if (!Number.isSafeInteger(attempts) || attempts < 1) {
    throw new Error('attempts must be at least 1')
  }
  if (!Number.isFinite(deadlineMs) || deadlineMs <= 0) {
    throw new Error('deadlineMs must be greater than 0')
  }
  const deadlineAt = configuredDeadlineAt ?? Date.now() + deadlineMs
  const initialRemainingMs = deadlineAt - Date.now()
  if (initialRemainingMs <= 0) {
    throw new Error(`Deployment propagation exceeded the ${deadlineMs}ms deadline`)
  }
  const controller = new AbortController()
  const deadlineError = new Error(`Deployment propagation exceeded the ${deadlineMs}ms deadline`)
  const deadline = new Promise((_, reject) => {
    controller.signal.addEventListener('abort', () => reject(controller.signal.reason), { once: true })
  })
  const deadlineTimer = setTimeout(() => controller.abort(deadlineError), initialRemainingMs)
  let lastError
  try {
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        return await Promise.race([
          Promise.resolve().then(() => check({ deadlineAt, signal: controller.signal })),
          deadline,
        ])
      } catch (error) {
        if (controller.signal.aborted) throw controller.signal.reason
        lastError = error
        if (error?.code !== DEPLOYMENT_PROPAGATION_ERROR_CODE) {
          throw error
        }
      }
      if (attempt < attempts && retryDelayMs > 0) {
        const remainingMs = deadlineAt - Date.now()
        if (remainingMs <= 0) throw deadlineError
        await Promise.race([
          waitImpl(Math.min(retryDelayMs, remainingMs)),
          deadline,
        ])
      }
    }
    throw lastError
  } finally {
    clearTimeout(deadlineTimer)
  }
}

function assertStatus(response, expected, label, { retryNotFound = false } = {}) {
  if (!expected.includes(response.status)) {
    const message = `${label} returned HTTP ${response.status}; expected ${expected.join(' or ')}`
    if (retryNotFound && response.status === 404) {
      throw new DeploymentPropagationError(message)
    }
    throw new Error(message)
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

function assertStaticCsp(csp, label, { appOrigin, dataOrigin }) {
  const expectedDirectives = new Map([
    ['default-src', ["'self'"]],
    ['base-uri', ["'self'"]],
    ['object-src', ["'none'"]],
    ['frame-ancestors', ["'none'"]],
    ['connect-src', unique([
      "'self'",
      dataOrigin,
      CLOUDFLARE_WEB_ANALYTICS_RUM_URL,
      TURNSTILE_ORIGIN,
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
    assertStatus(response, [200], `${label} ${asset.kind} asset`, { retryNotFound: true })
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

function assertDataContract(value, validator, label) {
  if (!validator(value)) {
    const errors = (validator.errors ?? [])
      .slice(0, 3)
      .map((error) => `${error.instancePath || '/'} ${error.message || 'is invalid'}`)
      .join('; ')
    throw new Error(`${label} failed data contract validation${errors ? `: ${errors}` : ''}`)
  }
  return value
}

function sameOriginDataUrl(baseUrl, reference, label) {
  if (typeof reference !== 'string' || reference.trim() === '') {
    throw new Error(`${label} path must be a non-empty string`)
  }
  let resolved
  try {
    resolved = new URL(reference, baseUrl)
  } catch {
    throw new Error(`${label} path must be a valid URL reference`)
  }
  const base = new URL(baseUrl)
  if (
    resolved.protocol !== 'https:'
    || resolved.username
    || resolved.password
    || resolved.origin !== base.origin
  ) {
    throw new Error(`${label} must remain on the data manifest origin`)
  }
  return resolved.href
}

function assertDataVersion(value, expectedDataVersion, label) {
  if (value.dataVersion !== expectedDataVersion) {
    throw new Error(`${label} dataVersion must equal ${expectedDataVersion}`)
  }
}

async function fetchDataObject(url, label, requestOptions) {
  const response = await fetchWithTimeout(url, requestOptions)
  assertStatus(response, [200], label)
  return readJsonObject(response, label)
}

function versionedLeafUrl(baseUrl, path, dataVersion, label) {
  const url = new URL(sameOriginDataUrl(baseUrl, path, label))
  url.searchParams.set('_miku_data_version', dataVersion)
  return url.href
}

async function checkDataGraph(manifestUrl, requestOptions) {
  const manifest = assertDataContract(
    await fetchDataObject(manifestUrl, 'Data root manifest', requestOptions),
    validateRootManifest,
    'Data root manifest',
  )
  const dataVersion = manifest.dataVersion

  const callGuideUrl = sameOriginDataUrl(
    manifestUrl,
    manifest.manifests.callGuide,
    'Call-guide manifest',
  )
  const callGuide = assertDataContract(
    await fetchDataObject(callGuideUrl, 'Call-guide manifest', requestOptions),
    validateCallGuideManifest,
    'Call-guide manifest',
  )
  assertDataVersion(callGuide, dataVersion, 'Call-guide manifest')
  if (!Array.isArray(callGuide.songs) || callGuide.songs.length === 0) {
    throw new Error('Call-guide manifest must include a representative song')
  }
  const songEntry = callGuide.songs.find((entry) => entry?.id === '39-music') ?? callGuide.songs[0]
  const songUrl = versionedLeafUrl(
    callGuideUrl,
    songEntry.path,
    dataVersion,
    'Representative song',
  )
  const song = assertDataContract(
    await fetchDataObject(songUrl, 'Representative song', requestOptions),
    validateRuntimeSong,
    'Representative song',
  )
  assertDataVersion(song, dataVersion, 'Representative song')
  if (song.id !== songEntry.id) {
    throw new Error('Representative song id must match its manifest entry')
  }

  const eventIndexUrl = sameOriginDataUrl(
    manifestUrl,
    manifest.manifests.eventCalendar,
    'Event-calendar index',
  )
  const eventIndex = assertDataContract(
    await fetchDataObject(eventIndexUrl, 'Event-calendar index', requestOptions),
    validateEventCalendarIndex,
    'Event-calendar index',
  )
  assertDataVersion(eventIndex, dataVersion, 'Event-calendar index')
  if (eventIndex.availableMonths.length === 0) {
    throw new Error('Event-calendar index must include availableMonths')
  }
  let representativeMonth = null
  for (const monthCandidate of [...eventIndex.availableMonths].reverse()) {
    const monthUrl = sameOriginDataUrl(
      eventIndexUrl,
      `months/${monthCandidate}.json`,
      'Representative event month',
    )
    const monthValue = assertDataContract(
      await fetchDataObject(
        monthUrl,
        'Representative event month',
        requestOptions,
      ),
      validateEventCalendarMonth,
      'Representative event month',
    )
    assertDataVersion(monthValue, dataVersion, 'Representative event month')
    if (monthValue.month !== monthCandidate) {
      throw new Error('Representative event month must match the index')
    }
    representativeMonth ??= { month: monthCandidate, url: monthUrl, value: monthValue }
    if (monthValue.events.length > 0) {
      representativeMonth = { month: monthCandidate, url: monthUrl, value: monthValue }
      break
    }
  }
  if (!representativeMonth) {
    throw new Error('Event-calendar index did not resolve a representative month')
  }
  const {
    month,
    url: eventMonthUrl,
    value: eventMonth,
  } = representativeMonth

  let event = null
  let eventDetailUrl = null
  const eventEntry = eventMonth.events[0]
  if (eventEntry !== undefined) {
    eventDetailUrl = versionedLeafUrl(
      eventMonthUrl,
      eventEntry.path,
      dataVersion,
      'Representative event detail',
    )
    event = assertDataContract(
      await fetchDataObject(eventDetailUrl, 'Representative event detail', requestOptions),
      validateRuntimeEvent,
      'Representative event detail',
    )
    assertDataVersion(event, dataVersion, 'Representative event detail')
    if (event.id !== eventEntry.id) {
      throw new Error('Representative event detail id must match its month entry')
    }
  }

  return {
    callGuideUrl,
    dataVersion,
    eventDetailUrl,
    eventId: event?.id ?? null,
    eventIndexUrl,
    eventMonthUrl,
    month,
    schemaVersion: manifest.schemaVersion,
    songId: song.id,
    songUrl,
  }
}

function productionAliasOrigin(deploymentOrigin) {
  const deployment = new URL(deploymentOrigin)
  deployment.hostname = deployment.hostname.replace(/^[^.]+\./, '')
  return deployment.origin
}

async function checkProductionAliasRedirect(
  deploymentOrigin,
  appOrigin,
  expectedReleaseId,
  requestOptions,
) {
  const aliasOrigin = productionAliasOrigin(deploymentOrigin)
  const pathAndQuery = `/api/ready?alias-smoke=${encodeURIComponent(expectedReleaseId)}`
  const response = await fetchWithTimeout(`${aliasOrigin}${pathAndQuery}`, requestOptions)
  assertStatus(response, [308], 'Production pages.dev alias redirect', { retryNotFound: true })
  const expectedLocation = `${appOrigin}${pathAndQuery}`
  if (response.headers.get('location') !== expectedLocation) {
    throw new Error(`Production pages.dev alias must redirect to ${expectedLocation}`)
  }
  return { location: expectedLocation, origin: aliasOrigin, status: response.status }
}

function assertFunctionResponseSecurity(response, label) {
  assertFunctionSecurityHeaders(response.headers, label)
}

function responseSetCookies(response) {
  if (typeof response.headers.getSetCookie === 'function') {
    return response.headers.getSetCookie()
  }
  const combined = response.headers.get('set-cookie')
  return combined ? [combined] : []
}

function parseSetCookie(cookie) {
  const [nameValue, ...attributeParts] = cookie.split(';')
  const separator = nameValue.indexOf('=')
  if (separator <= 0) return null
  const attributes = new Map()
  for (const part of attributeParts) {
    const trimmed = part.trim()
    const attributeSeparator = trimmed.indexOf('=')
    const name = (attributeSeparator < 0 ? trimmed : trimmed.slice(0, attributeSeparator)).toLowerCase()
    const value = attributeSeparator < 0 ? true : trimmed.slice(attributeSeparator + 1)
    attributes.set(name, value)
  }
  return {
    attributes,
    name: nameValue.slice(0, separator),
    value: nameValue.slice(separator + 1),
  }
}

function isSecureHostCookie(cookie, { maxAge, sameSite }) {
  if (!cookie) return false
  const { attributes } = cookie
  return (
    attributes.get('path') === '/'
    && attributes.has('httponly')
    && attributes.has('secure')
    && String(attributes.get('samesite')).toLowerCase() === sameSite.toLowerCase()
    && String(attributes.get('max-age')) === String(maxAge)
    && !attributes.has('domain')
  )
}

async function readExpectedApiError(response, label, expectedError) {
  const body = await readJsonObject(response, label)
  if (
    body.error !== expectedError
    || typeof body.requestId !== 'string'
    || body.requestId.trim() === ''
  ) {
    throw new Error(`${label} returned an invalid API error contract`)
  }
  return body
}

async function checkAuthAndLogout(appOrigin, deploymentOrigin, requestOptions) {
  const returnTo = `${appOrigin}/#/events`
  const oauthUrl = `${appOrigin}/api/auth/github/start?returnTo=${encodeURIComponent(returnTo)}`
  const oauthResponse = await fetchWithTimeout(oauthUrl, requestOptions)
  assertStatus(oauthResponse, [302], 'Production OAuth start', { retryNotFound: true })
  assertFunctionResponseSecurity(oauthResponse, 'Production OAuth start')
  let authorizationUrl
  try {
    authorizationUrl = new URL(oauthResponse.headers.get('location') || '')
  } catch {
    throw new Error('Production OAuth start did not return an absolute authorization redirect')
  }
  if (
    authorizationUrl.origin !== 'https://github.com'
    || authorizationUrl.pathname !== '/login/oauth/authorize'
    || !authorizationUrl.searchParams.get('client_id')
    || authorizationUrl.searchParams.get('redirect_uri') !== `${appOrigin}/api/auth/github/callback`
    || !authorizationUrl.searchParams.get('state')
    || !/^[A-Za-z0-9_-]{43}$/.test(authorizationUrl.searchParams.get('code_challenge') || '')
    || authorizationUrl.searchParams.get('code_challenge_method') !== 'S256'
    || authorizationUrl.searchParams.has('scope')
  ) {
    throw new Error('Production OAuth start returned an invalid GitHub authorization redirect')
  }
  const oauthCookies = responseSetCookies(oauthResponse)
  const oauthCookie = oauthCookies.length === 1 ? parseSetCookie(oauthCookies[0]) : null
  if (
    oauthCookie?.name !== '__Host-miku_call_guide_oauth'
    || !oauthCookie.value
    || !isSecureHostCookie(oauthCookie, { maxAge: 600, sameSite: 'Lax' })
  ) {
    throw new Error('Production OAuth start did not set the secure transaction cookie')
  }

  const logoutResponse = await fetchWithTimeout(`${appOrigin}/api/auth/logout`, {
    ...requestOptions,
    headers: { origin: appOrigin },
    method: 'POST',
  })
  assertStatus(logoutResponse, [204], 'Production logout', { retryNotFound: true })
  assertFunctionResponseSecurity(logoutResponse, 'Production logout')
  const logoutCookies = responseSetCookies(logoutResponse)
  const parsedLogoutCookies = logoutCookies.map(parseSetCookie).filter(Boolean)
  for (const [cookieName, sameSite] of [
    ['__Host-miku_call_guide_session', 'Strict'],
    ['miku_call_guide_session', 'Strict'],
    ['__Host-miku_call_guide_oauth', 'Lax'],
    ['miku_call_guide_oauth', 'Lax'],
  ]) {
    const cookie = parsedLogoutCookies.find((candidate) => candidate.name === cookieName)
    const attributes = cookie?.attributes
    const valid = (
      cookie?.value === ''
      && attributes?.get('path') === '/'
      && attributes.has('httponly')
      && String(attributes.get('samesite')).toLowerCase() === sameSite.toLowerCase()
      && String(attributes.get('max-age')) === '0'
      && !attributes.has('domain')
      && (!cookieName.startsWith('__Host-') || attributes.has('secure'))
    )
    if (!valid) {
      throw new Error(`Production logout did not clear ${cookieName}`)
    }
  }

  const immutableOauthResponse = await fetchWithTimeout(
    `${deploymentOrigin}/api/auth/github/start`,
    requestOptions,
  )
  assertStatus(immutableOauthResponse, [403], 'Immutable OAuth rejection', { retryNotFound: true })
  assertFunctionResponseSecurity(immutableOauthResponse, 'Immutable OAuth rejection')
  await readExpectedApiError(
    immutableOauthResponse,
    'Immutable OAuth rejection',
    'invalid_request_origin',
  )
  if (responseSetCookies(immutableOauthResponse).length > 0) {
    throw new Error('Immutable OAuth rejection must not set a transaction cookie')
  }

  const immutableLogoutResponse = await fetchWithTimeout(
    `${deploymentOrigin}/api/auth/logout`,
    {
      ...requestOptions,
      headers: { origin: appOrigin },
      method: 'POST',
    },
  )
  assertStatus(immutableLogoutResponse, [403], 'Immutable logout rejection', { retryNotFound: true })
  assertFunctionResponseSecurity(immutableLogoutResponse, 'Immutable logout rejection')
  await readExpectedApiError(
    immutableLogoutResponse,
    'Immutable logout rejection',
    'invalid_request_origin',
  )
  if (responseSetCookies(immutableLogoutResponse).length > 0) {
    throw new Error('Immutable logout rejection must not clear or set cookies')
  }

  return {
    authorizationOrigin: authorizationUrl.origin,
    immutableLogoutStatus: immutableLogoutResponse.status,
    immutableOauthStatus: immutableOauthResponse.status,
    logoutStatus: logoutResponse.status,
    oauthStatus: oauthResponse.status,
  }
}

async function checkReleaseMarker(origin, label, expectedReleaseId, requestOptions) {
  const url = `${origin}/release.json?release=${encodeURIComponent(expectedReleaseId)}`
  const response = await fetchWithTimeout(url, requestOptions)
  assertStatus(response, [200], `${label} release marker`, { retryNotFound: true })
  const marker = await readJsonObject(response, `${label} release marker`)
  if (Object.keys(marker).length !== 1 || marker.releaseId !== expectedReleaseId) {
    throw new DeploymentPropagationError(`${label} release mismatch; expected ${expectedReleaseId}`)
  }
  return marker.releaseId
}

async function assertReadyResponse(response, label) {
  assertStatus(response, [200], `${label} readiness Function`, { retryNotFound: true })
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
  assertStatus(rootResponse, [200], `${label} root`, { retryNotFound: true })
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
  fetchImpl = globalThis.fetch,
  attempts = DEFAULT_SMOKE_ATTEMPTS,
  propagationDeadlineMs = DEFAULT_PROPAGATION_DEADLINE_MS,
  retryDelayMs = DEFAULT_SMOKE_RETRY_DELAY_MS,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  const normalizedOrigin = requiredAppOrigin(appOrigin, 'APP_SMOKE_ORIGIN')
  const normalizedDeploymentOrigin = requiredDeploymentOrigin(
    deploymentOrigin,
    normalizedOrigin,
  )
  const normalizedManifestUrl = requiredUrl(dataManifestUrl, 'DATA_MANIFEST_URL')
  const normalizedReleaseId = requiredReleaseId(expectedReleaseId)
  const canonicalUrl = `${normalizedOrigin}/`
  const requestOptions = { fetchImpl, timeoutMs }
  const propagationDeadlineAt = Date.now() + propagationDeadlineMs
  const retryOptions = {
    attempts,
    deadlineAt: propagationDeadlineAt,
    deadlineMs: propagationDeadlineMs,
    retryDelayMs,
  }
  const withPagesRetry = (check) => withPropagationRetry(
    ({ deadlineAt, signal }) => check({
      deadlineAt,
      fetchImpl,
      redirect: 'manual',
      signal,
      timeoutMs,
    }),
    retryOptions,
  )
  const cspContext = {
    appOrigin: normalizedOrigin,
    dataOrigin: new URL(normalizedManifestUrl).origin,
  }

  const deployment = await withPagesRetry((surfaceRequestOptions) => checkAppSurface(
    normalizedDeploymentOrigin,
    'Deployment',
    canonicalUrl,
    normalizedReleaseId,
    cspContext,
    surfaceRequestOptions,
  ))
  const app = await withPagesRetry((surfaceRequestOptions) => checkAppSurface(
    normalizedOrigin,
    'Configured app',
    canonicalUrl,
    normalizedReleaseId,
    cspContext,
    surfaceRequestOptions,
  ))

  const alias = await withPagesRetry((surfaceRequestOptions) => checkProductionAliasRedirect(
    normalizedDeploymentOrigin,
    normalizedOrigin,
    normalizedReleaseId,
    surfaceRequestOptions,
  ))

  const auth = await withPagesRetry((surfaceRequestOptions) => checkAuthAndLogout(
    normalizedOrigin,
    normalizedDeploymentOrigin,
    surfaceRequestOptions,
  ))

  const ogImage = await withPagesRetry(async (surfaceRequestOptions) => {
    const response = await fetchWithTimeout(
      `${normalizedOrigin}/og-image.png`,
      surfaceRequestOptions,
    )
    assertStatus(response, [200], 'OG image', { retryNotFound: true })
    const imageType = (response.headers.get('content-type') || '').toLowerCase()
    if (!imageType.startsWith('image/')) throw new Error('OG image must return an image content-type')
    const bytes = (await response.arrayBuffer()).byteLength
    if (bytes < MINIMUM_OG_IMAGE_BYTES) {
      throw new Error(`OG image is too small (${bytes} bytes; expected at least ${MINIMUM_OG_IMAGE_BYTES})`)
    }
    return { bytes, status: response.status }
  })

  const data = await checkDataGraph(normalizedManifestUrl, {
    ...requestOptions,
    redirect: 'manual',
  })

  return {
    alias,
    app: {
      assets: app.assets,
      canonical: app.canonical,
      missingAsset: app.missingAsset,
      releaseId: app.releaseId,
      status: app.status,
    },
    auth,
    data,
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
    `- production alias: HTTP ${report.alias.status}, ${report.alias.origin} -> ${report.alias.location}`,
    `- auth: OAuth HTTP ${report.auth.oauthStatus}, logout HTTP ${report.auth.logoutStatus}, immutable rejects ${report.auth.immutableOauthStatus}/${report.auth.immutableLogoutStatus}`,
    `- static assets: deployment ${report.deployment.assets.length}, configured app ${report.app.assets.length}`,
    `- missing asset guards: deployment HTTP ${report.deployment.missingAsset.status}, configured app HTTP ${report.app.missingAsset.status}`,
    `- readiness: deployment HTTP ${report.readiness.deployment}, configured app HTTP ${report.readiness.app}`,
    `- OG image: HTTP ${report.ogImage.status}, ${report.ogImage.bytes} bytes`,
    `- data graph: schema ${report.data.schemaVersion}, version ${report.data.dataVersion}, song ${report.data.songId}, month ${report.data.month}, event ${report.data.eventId ?? '(empty month)'}`,
  ].join('\n')
}

async function runCli() {
  const report = await runPostDeploySmoke({
    appOrigin: process.env.APP_SMOKE_ORIGIN,
    dataManifestUrl: process.env.DATA_MANIFEST_URL,
    deploymentOrigin: process.env.DEPLOYMENT_SMOKE_ORIGIN,
    expectedReleaseId: process.env.EXPECTED_RELEASE_ID,
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
