import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { chromium } from '@playwright/test'
import { canonicalProductionOrigin } from '../functions/_lib/productionHostname.js'
import {
  assertStaticSecurityHeaders,
  requiredReleaseId,
} from './post-deploy-smoke.mjs'
import {
  CLOUDFLARE_WEB_ANALYTICS_BEACON_URL,
  CLOUDFLARE_WEB_ANALYTICS_RUM_URL,
} from './static-csp-sources.mjs'

const DEFAULT_DEPLOYMENT_PROPAGATION_ATTEMPTS = 25
const DEFAULT_DEPLOYMENT_PROPAGATION_RETRY_DELAY_MS = 5_000
const DEFAULT_BROWSER_PROPAGATION_DEADLINE_MS = 120_000
const ANALYTICS_OBSERVATION_TIMEOUT_MS = 15_000
const BROWSER_DEPLOYMENT_PROPAGATION_ERROR_CODE = 'BROWSER_DEPLOYMENT_PROPAGATION'
const CLOUDFLARE_BEACON_TOKEN_PATTERN = /^[a-f0-9]{32}$/
export const BROWSER_SMOKE_ROUTES = Object.freeze(['/', '/#/events', '/#/songs/39-music'])

export function assertBuiltArtifactResponse(expected, delivered) {
  if (!expected?.length || !Buffer.from(expected).equals(Buffer.from(delivered))) {
    throw new Error('Browser response does not match the current built artifact')
  }
}

export async function acknowledgeInitialSpoilerDisclaimer(page) {
  const dialog = page.getByRole('alertdialog', { name: '스포일러 안내' })

  await dialog.waitFor({ state: 'visible' })
  await dialog.getByRole('button', { name: '확인하고 계속하기' }).click()
  await dialog.waitFor({ state: 'detached' })
}

export async function waitForRouteReady(page) {
  await page.getByRole('main').waitFor({ state: 'visible' })
  await page.waitForFunction(() => {
    const main = document.querySelector('[role="main"], main')
    return Boolean(main)
      && !main.querySelector('[aria-busy="true"]')
      && !main.querySelector('.app-loading')
  })
}

const ROUTE_DATA_SELECTORS = Object.freeze({
  '/': 'a.catalog-song-card',
  '/#/events': '.event-calendar-grid',
  '/#/songs/39-music': '.lyric-line[data-line-id]',
})

export async function assertRouteDataHealthy(page, route) {
  const selector = ROUTE_DATA_SELECTORS[route]
  if (!selector) throw new Error(`No data-health selector is configured for ${route}`)
  await page.waitForFunction((expectedSelector) => {
    const main = document.querySelector('[role="main"], main')
    return Boolean(main?.querySelector('[role="alert"]'))
      || Boolean(main?.querySelector(expectedSelector))
  }, selector)
  const state = await page.evaluate((expectedSelector) => {
    const main = document.querySelector('[role="main"], main')
    const visibleAlert = Array.from(main?.querySelectorAll('[role="alert"]') ?? [])
      .find((element) => {
        const style = globalThis.getComputedStyle(element)
        return style.display !== 'none' && style.visibility !== 'hidden'
      })
    return {
      alertText: (visibleAlert?.textContent || '').trim().slice(0, 500),
      hasExpectedContent: Boolean(main?.querySelector(expectedSelector)),
    }
  }, selector)
  if (state.alertText) {
    throw new Error(`${route} rendered a handled data error: ${state.alertText}`)
  }
  if (!state.hasExpectedContent) {
    throw new Error(`${route} did not render its representative data content`)
  }
}

export async function assertPreviewReadOnly(page) {
  const state = await page.evaluate(() => {
    const text = document.body.textContent || ''
    const submissionButton = Array.from(document.querySelectorAll('button'))
      .some((button) => /^(?:일정 추가|일정 제보하기|수정 요청)$/.test((button.textContent || '').trim()))
    const oauthControl = Array.from(document.querySelectorAll('a, button'))
      .some((element) => (
        /\/api\/auth\/github\/start(?:[?#]|$)/.test(element.getAttribute('href') || '')
        || /GitHub\s*로그인/i.test((element.textContent || '').trim())
      ))
    return {
      hasReadOnlyLabel: text.includes('미리보기 · 읽기 전용')
        && text.includes('로그인, 일정 제보, 수정 요청'),
      hasSubmissionButton: submissionButton,
      hasOauthControl: oauthControl,
      hasTurnstile: Boolean(document.querySelector([
        'iframe[src*="challenges.cloudflare.com"]',
        '.cf-turnstile',
        '[data-sitekey]',
      ].join(','))),
    }
  })
  if (
    !state.hasReadOnlyLabel
    || state.hasOauthControl
    || state.hasSubmissionButton
    || state.hasTurnstile
  ) {
    throw new Error(`Pages preview is not read-only: ${detail(state)}`)
  }
}

function requiredOrigin(value, name, { requirePagesDev = false } = {}) {
  if (typeof value !== 'string' || value !== value.trim()) {
    throw new Error(`${name} must be an exact HTTPS origin`)
  }
  let parsed
  try {
    parsed = new URL(value)
  } catch {
    throw new Error(`${name} must be an exact HTTPS origin`)
  }
  if (
    parsed.protocol !== 'https:'
    || parsed.username
    || parsed.password
    || parsed.pathname !== '/'
    || parsed.search
    || parsed.hash
    || parsed.origin !== value
  ) {
    throw new Error(`${name} must be an exact HTTPS origin`)
  }
  if (canonicalProductionOrigin(value) !== value) {
    throw new Error(`${name} must be an exact public HTTPS origin`)
  }
  if (requirePagesDev && !parsed.hostname.endsWith('.pages.dev')) {
    throw new Error(`${name} must use a pages.dev hostname`)
  }
  return value
}

function requiredUrl(value, name) {
  if (typeof value !== 'string' || value !== value.trim()) {
    throw new Error(`${name} must be an absolute HTTPS URL`)
  }
  let parsed
  try {
    parsed = new URL(value)
  } catch {
    throw new Error(`${name} must be an absolute HTTPS URL`)
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) {
    throw new Error(`${name} must be an absolute HTTPS URL`)
  }
  return parsed.href
}

function detail(value) {
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

export class BrowserDeploymentPropagationError extends Error {
  constructor(message, options) {
    super(message, options)
    this.name = 'BrowserDeploymentPropagationError'
    this.code = BROWSER_DEPLOYMENT_PROPAGATION_ERROR_CODE
  }
}

export async function withDeploymentPropagationRetry(check, {
  attempts = DEFAULT_DEPLOYMENT_PROPAGATION_ATTEMPTS,
  deadlineMs = DEFAULT_BROWSER_PROPAGATION_DEADLINE_MS,
  retryDelayMs = DEFAULT_DEPLOYMENT_PROPAGATION_RETRY_DELAY_MS,
  waitImpl = wait,
} = {}) {
  if (!Number.isSafeInteger(attempts) || attempts < 1) {
    throw new Error('attempts must be at least 1')
  }

  if (!Number.isFinite(deadlineMs) || deadlineMs <= 0) {
    throw new Error('deadlineMs must be greater than 0')
  }
  const deadlineAt = Date.now() + deadlineMs
  const controller = new AbortController()
  const deadlineError = new Error(`Browser deployment propagation exceeded the ${deadlineMs}ms deadline`)
  const deadline = new Promise((_, reject) => {
    controller.signal.addEventListener('abort', () => reject(controller.signal.reason), { once: true })
  })
  const deadlineTimer = setTimeout(() => controller.abort(deadlineError), deadlineMs)
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
        if (
          error?.code !== BROWSER_DEPLOYMENT_PROPAGATION_ERROR_CODE
          || attempt === attempts
        ) {
          throw error
        }
      }
      if (retryDelayMs > 0) {
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

export function appAssetFailure(response, surfaceOrigin) {
  let url
  try {
    url = new URL(response.url())
  } catch {
    return ''
  }
  if (url.origin !== surfaceOrigin || !url.pathname.startsWith('/assets/')) return ''

  const extension = url.pathname.match(/\.(css|js)$/i)?.[1]?.toLowerCase()
  if (!extension) return ''
  const status = response.status()
  // Playwright exposes a successful conditional cache revalidation as 304;
  // the browser reuses the previously validated body and MIME metadata.
  if (status === 304) return ''
  const contentType = String(response.headers()['content-type'] || '').toLowerCase()
  const expectedType = extension === 'css' ? 'text/css' : /javascript|ecmascript/
  const typeMatches = typeof expectedType === 'string'
    ? contentType.startsWith(expectedType)
    : expectedType.test(contentType)
  if (status === 200 && typeMatches) return ''

  return `${url.href} returned HTTP ${status} with content-type ${contentType || '(missing)'}`
}

function parsedUrl(rawUrl) {
  let url
  try {
    url = new URL(rawUrl)
  } catch {
    return null
  }
  return url
}

function isGoogleAnalyticsHost(hostname) {
  return hostname === 'google-analytics.com'
    || hostname.endsWith('.google-analytics.com')
    || hostname === 'googletagmanager.com'
    || hostname.endsWith('.googletagmanager.com')
}

function isSuccessfulStatus(status) {
  return Number.isInteger(status) && status >= 200 && status < 300
}

function hasPublicBeaconConfiguration(value) {
  if (typeof value !== 'string' || value.length === 0) return false
  try {
    const configuration = JSON.parse(value)
    return configuration !== null
      && typeof configuration === 'object'
      && !Array.isArray(configuration)
      && Object.keys(configuration).length === 1
      && typeof configuration.token === 'string'
      && CLOUDFLARE_BEACON_TOKEN_PATTERN.test(configuration.token)
  } catch {
    return false
  }
}

function isExactUrl(rawUrl, expectedUrl) {
  const url = parsedUrl(rawUrl)
  return url?.href === expectedUrl
}

function isExactRumUrl(rawUrl) {
  return isExactUrl(rawUrl, CLOUDFLARE_WEB_ANALYTICS_RUM_URL)
}

function isCloudflareAnalyticsScriptUrl(rawUrl) {
  const url = parsedUrl(rawUrl)
  return url?.hostname === 'static.cloudflareinsights.com'
}

export function classifyAnalyticsRequest({ url: rawUrl }, surfaceOrigin) {
  const url = parsedUrl(rawUrl)
  if (!url) return null
  if (
    isGoogleAnalyticsHost(url.hostname)
    || (url.origin === surfaceOrigin && url.pathname.startsWith('/825i/ga/'))
  ) {
    return { kind: 'obsolete-google', url: url.href }
  }
  if (url.hostname === 'static.cloudflareinsights.com') {
    return {
      kind: isExactUrl(url.href, CLOUDFLARE_WEB_ANALYTICS_BEACON_URL)
        ? 'cloudflare-beacon'
        : 'cloudflare-beacon-invalid',
      url: url.href,
    }
  }
  if (url.hostname === 'cloudflareinsights.com') {
    return {
      kind: isExactRumUrl(url.href) ? 'cloudflare-rum' : 'cloudflare-rum-invalid',
      url: url.href,
    }
  }
  return null
}

function describeAnalyticsObservation(observation) {
  const status = observation.status === undefined ? '' : ` returned HTTP ${observation.status}`
  const failure = observation.failure ? ' failed (CORS/CSP/network)' : ''
  return `${observation.kind} ${observation.method || 'UNKNOWN'}${status}${failure}`
}

function analyticsCspViolations(cspViolations, surfaceOrigin) {
  return cspViolations.filter((violation) => {
    const blockedUrl = parsedUrl(violation?.blockedURI)
    return blockedUrl !== null && classifyAnalyticsRequest({ url: blockedUrl.href }, surfaceOrigin) !== null
  })
}

function isCloudflareAnalyticsObservation(observation) {
  return observation.kind === 'cloudflare-beacon'
    || observation.kind === 'cloudflare-beacon-invalid'
    || observation.kind === 'cloudflare-rum'
    || observation.kind === 'cloudflare-rum-invalid'
}

function successfulAnalyticsResponse(observation, { method, url, kind }) {
  return observation.kind === kind
    && observation.method === method
    && observation.url === url
    && observation.responseUrl === url
    && !observation.failure
    && isSuccessfulStatus(observation.status)
}

export function assertCloudflareWebAnalyticsContract({
  cspViolations = [],
  isPreview,
  observations = [],
  scripts = [],
  surfaceOrigin,
} = {}) {
  const failures = []
  const cloudflareScripts = scripts.filter((script) => isCloudflareAnalyticsScriptUrl(script?.src))
  const obsoleteScripts = scripts.filter((script) => (
    classifyAnalyticsRequest({ url: script?.src }, surfaceOrigin)?.kind === 'obsolete-google'
  ))
  const cloudflareObservations = observations.filter(isCloudflareAnalyticsObservation)
  const obsoleteObservations = observations.filter((observation) => observation.kind === 'obsolete-google')

  if (obsoleteScripts.length > 0 || obsoleteObservations.length > 0) {
    failures.push('All surfaces must reject obsolete Google or Tag Gateway analytics activity')
  }

  if (!isPreview || cloudflareScripts.length > 0 || cloudflareObservations.length > 0) {
    if (cloudflareScripts.length !== 1) {
      failures.push(`Pages must contain exactly one Cloudflare beacon script; found ${cloudflareScripts.length}`)
    } else {
      const [script] = cloudflareScripts
      if (script.src !== CLOUDFLARE_WEB_ANALYTICS_BEACON_URL) {
        failures.push(`Cloudflare beacon script must use ${CLOUDFLARE_WEB_ANALYTICS_BEACON_URL}`)
      }
      if (script.type !== '' && script.type !== 'text/javascript') {
        failures.push('Cloudflare beacon script must use the Pages classic script format')
      }
      if (!hasPublicBeaconConfiguration(script.dataCfBeacon)) {
        failures.push('Cloudflare beacon script must carry a public data-cf-beacon token configuration')
      }
    }

    for (const observation of cloudflareObservations) {
      if (observation.kind.endsWith('-invalid')
        || (observation.responseUrl && observation.responseUrl !== observation.url)) {
        failures.push(`Cloudflare analytics used an unexpected endpoint: ${describeAnalyticsObservation(observation)}`)
      } else if (observation.failure) {
        failures.push(`Cloudflare analytics network failure: ${describeAnalyticsObservation(observation)}`)
      } else if (observation.status !== undefined && !isSuccessfulStatus(observation.status)) {
        failures.push(`Cloudflare analytics unsuccessful response: ${describeAnalyticsObservation(observation)}`)
      } else if (observation.method !== (observation.kind === 'cloudflare-beacon' ? 'GET' : 'POST')) {
        failures.push(`Cloudflare analytics unexpected method: ${describeAnalyticsObservation(observation)}`)
      } else if (observation.status === undefined) {
        failures.push(`Cloudflare analytics request did not complete: ${describeAnalyticsObservation(observation)}`)
      }
    }

    if (!cloudflareObservations.some((observation) => successfulAnalyticsResponse(observation, {
      kind: 'cloudflare-beacon',
      method: 'GET',
      url: CLOUDFLARE_WEB_ANALYTICS_BEACON_URL,
    }))) {
      failures.push('Cloudflare beacon script did not fetch successfully from its exact URL')
    }
    if (!cloudflareObservations.some((observation) => successfulAnalyticsResponse(observation, {
      kind: 'cloudflare-rum',
      method: 'POST',
      url: CLOUDFLARE_WEB_ANALYTICS_RUM_URL,
    }))) {
      failures.push('Cloudflare Web Analytics did not send a successful POST to the exact RUM endpoint')
    }
  }

  for (const violation of analyticsCspViolations(cspViolations, surfaceOrigin)) {
    failures.push(`Analytics CSP violation: ${violation.effectiveDirective || 'unknown directive'}`)
  }

  if (failures.length > 0) {
    throw new Error(`Cloudflare Web Analytics contract failed:\n${failures.map((failure) => `- ${failure}`).join('\n')}`)
  }
}

export function initialDocumentDeliveryFailure(response, label) {
  if (!response) return ''
  return deploymentHttpStatusFailure(response.status(), label)
}

export function deploymentHttpStatusFailure(status, label) {
  if (status !== 404) return ''
  return `${label} returned HTTP ${status} while the Pages deployment is propagating`
}

async function browserFailureState(page) {
  try {
    return await page.evaluate(() => ({
      root: (document.querySelector('#root')?.textContent || '').trim().slice(0, 500),
      scripts: Array.from(document.scripts, (script) => script.src || '[inline]').slice(0, 20),
      violations: globalThis.__mikuPreviewCspViolations || [],
    }))
  } catch (error) {
    return { inspectionError: error instanceof Error ? error.message : String(error) }
  }
}

export function assertNoBrowserSecurityErrors({
  cspViolations = [],
  pageErrors = [],
} = {}) {
  const failures = [
    ...cspViolations.map((value) => `CSP: ${detail(value)}`),
    ...pageErrors.map((value) => `page: ${detail(value)}`),
  ]
  if (failures.length > 0) {
    throw new Error(`Browser smoke blocked promotion:\n${failures.join('\n')}`)
  }
}

async function responseHeaders(response) {
  if (typeof response.allHeaders === 'function') {
    return new Headers(await response.allHeaders())
  }
  return new Headers(response.headers())
}

function assertStatus(response, expected, label) {
  const status = response.status()
  if (status !== expected) {
    throw new Error(`${label} returned HTTP ${status}; expected ${expected}`)
  }
}

export function assertSurfaceNavigation(
  response,
  pageUrl,
  surfaceOrigin,
  label,
  { requireResponse = true } = {},
) {
  if (!response && requireResponse) {
    throw new Error(`${label} did not return a navigation response`)
  }
  if (response) assertStatus(response, 200, label)

  const locations = [
    ...(response ? [['response', response.url()]] : []),
    ['page', pageUrl],
  ]
  for (const [source, value] of locations) {
    let actual
    try {
      actual = new URL(value)
    } catch {
      throw new Error(`${label} ${source} URL must be absolute`)
    }
    if (actual.origin !== surfaceOrigin) {
      throw new Error(
        `${label} left requested origin ${surfaceOrigin}; ${source} URL was ${actual.href}`,
      )
    }
  }
}

async function assertReleaseMarker(request, surfaceOrigin, expectedReleaseId, label) {
  const response = await request.get(
    `${surfaceOrigin}/release.json?release=${encodeURIComponent(expectedReleaseId)}`,
    { headers: { 'cache-control': 'no-cache' } },
  )
  const deliveryFailure = deploymentHttpStatusFailure(
    response.status(),
    `${label} release marker`,
  )
  if (deliveryFailure) throw new BrowserDeploymentPropagationError(deliveryFailure)
  assertStatus(response, 200, `${label} release marker`)
  const marker = await response.json()
  if (
    !marker
    || typeof marker !== 'object'
    || Array.isArray(marker)
    || Object.keys(marker).length !== 1
    || marker.releaseId !== expectedReleaseId
  ) {
    throw new BrowserDeploymentPropagationError(
      `${label} release marker does not match the requested commit SHA`,
    )
  }
}

export async function runBrowserSmoke({
  appOrigin,
  browserType = chromium,
  dataManifestUrl,
  expectedReleaseId,
  requirePagesDev = false,
  signal,
  surfaceLabel = 'Browser surface',
  surfaceOrigin,
} = {}) {
  const normalizedAppOrigin = requiredOrigin(appOrigin, 'APP_SMOKE_ORIGIN')
  const normalizedSurfaceOrigin = requiredOrigin(
    surfaceOrigin,
    'BROWSER_SMOKE_ORIGIN',
    { requirePagesDev },
  )
  const normalizedManifestUrl = requiredUrl(dataManifestUrl, 'DATA_MANIFEST_URL')
  const normalizedReleaseId = requiredReleaseId(expectedReleaseId)
  if (signal?.aborted) throw signal.reason
  const browser = await browserType.launch({ headless: true })
  if (signal?.aborted) {
    await browser.close()
    throw signal.reason
  }
  const abortBrowser = () => {
    void browser.close()
  }
  signal?.addEventListener('abort', abortBrowser, { once: true })
  try {
    const context = await browser.newContext()
    const page = await context.newPage()
    const consoleDiagnostics = []
    const cspViolations = []
    const pageErrors = []
    const assetFailures = []
    const analyticsObservations = new Map()
    const analyticsScriptSnapshots = []
    const isAnalyticsPreview = requirePagesDev || normalizedSurfaceOrigin !== normalizedAppOrigin
    let notifyAnalytics = () => {}
    const observeAnalytics = (request) => {
      const classification = classifyAnalyticsRequest({ url: request.url() }, normalizedSurfaceOrigin)
      if (!classification) return null
      if (!analyticsObservations.has(request)) {
        analyticsObservations.set(request, { ...classification, method: request.method() })
      }
      return analyticsObservations.get(request)
    }
    let firstAssetFailureState = null
    let resolveFirstAssetFailure
    const firstAssetFailure = new Promise((resolve) => {
      resolveFirstAssetFailure = resolve
    })
    const recordAssetFailure = (failure, retryNotFound = false) => {
      if (!failure || assetFailures.includes(failure)) return
      assetFailures.push(failure)
      if (assetFailures.length === 1) {
        firstAssetFailureState = { message: failure, retryNotFound }
        resolveFirstAssetFailure(firstAssetFailureState)
      }
    }
    page.on('console', (message) => {
      consoleDiagnostics.push({ type: message.type(), text: message.text().replace(/\b[a-f0-9]{32}\b/gi, '[redacted beacon token]') })
    })
    page.on('pageerror', (error) => pageErrors.push(error.message))
    page.on('request', (request) => {
      observeAnalytics(request)
      notifyAnalytics()
    })
    page.on('response', (response) => {
      const request = response.request()
      const observation = observeAnalytics(request)
      if (observation) {
        observation.responseUrl = response.url()
        observation.responseStatus = response.status()
      }
      recordAssetFailure(
        appAssetFailure(response, normalizedSurfaceOrigin),
        response.status() === 404,
      )
    })
    page.on('requestfinished', (request) => {
      const observation = observeAnalytics(request)
      if (observation) observation.status = observation.responseStatus
      notifyAnalytics()
    })
    page.on('requestfailed', (request) => {
      const observation = observeAnalytics(request)
      if (observation) observation.failure = request.failure()?.errorText || 'network failure'
      notifyAnalytics()
      let url
      try {
        url = new URL(request.url())
      } catch {
        return
      }
      if (
        url.origin !== normalizedSurfaceOrigin
        || !/\/assets\/.*\.(?:css|js)$/i.test(url.pathname)
      ) return
      recordAssetFailure(
        `${url.href} request failed: ${request.failure()?.errorText || 'unknown error'}`,
      )
    })
    await page.addInitScript(() => {
      globalThis.__mikuPreviewCspViolations = []
      try {
        const initializationKey = 'miku-call-guide:browser-smoke-initialized'
        if (sessionStorage.getItem(initializationKey) !== '1') {
          localStorage.removeItem('miku-call-guide:spoiler-disclaimer-acknowledged')
          sessionStorage.setItem(initializationKey, '1')
        }
      } catch {
        // The gate intentionally remains required when storage is unavailable.
      }
      document.addEventListener('securitypolicyviolation', (event) => {
        globalThis.__mikuPreviewCspViolations.push({
          blockedURI: event.blockedURI,
          disposition: event.disposition,
          effectiveDirective: event.effectiveDirective,
          sourceFile: event.sourceFile,
        })
      })
    })

    try {
      for (const [index, route] of BROWSER_SMOKE_ROUTES.entries()) {
        const separator = route.includes('?') ? '&' : '?'
        let response = null
        if (index === 0) {
          response = await page.goto(
            `${normalizedSurfaceOrigin}${route}${separator}browser-smoke=${encodeURIComponent(normalizedReleaseId)}`,
            { waitUntil: 'domcontentloaded' },
          )
        } else if (route === '/#/events') {
          await page.getByRole('navigation', { name: 'Main navigation' })
            .getByRole('link', { name: 'Events', exact: true }).click()
          await page.waitForURL((url) => url.hash === '#/events')
        } else {
          await page.goBack()
          await waitForRouteReady(page)
          await assertRouteDataHealthy(page, '/')
          await page.goForward()
          await waitForRouteReady(page)
          await assertRouteDataHealthy(page, '/#/events')
          await page.getByRole('navigation', { name: 'Main navigation' })
            .getByRole('link', { name: 'Catalog', exact: true }).click()
          await assertRouteDataHealthy(page, '/')
          const songLink = page.locator('a.catalog-song-card[href="#/songs/39-music"]')
          await songLink.click()
          await page.waitForURL((url) => url.hash === '#/songs/39-music')
        }
        const routeLabel = `${surfaceLabel} route ${route}`
        const navigationOptions = { requireResponse: index === 0 }
        const initialDeliveryFailure = index === 0
          ? initialDocumentDeliveryFailure(response, routeLabel)
          : ''
        if (initialDeliveryFailure) {
          throw new BrowserDeploymentPropagationError(initialDeliveryFailure)
        }
        assertSurfaceNavigation(
          response,
          page.url(),
          normalizedSurfaceOrigin,
          routeLabel,
          navigationOptions,
        )
        if (index === 0) {
          const rootHeaders = await responseHeaders(response)
          assertStaticSecurityHeaders(rootHeaders, {
            appOrigin: normalizedAppOrigin,
            dataOrigin: new URL(normalizedManifestUrl).origin,
          }, `${surfaceLabel} root`)
          const acknowledgementFailure = await Promise.race([
            acknowledgeInitialSpoilerDisclaimer(page).then(() => null),
            firstAssetFailure,
          ])
          if (acknowledgementFailure) {
            const Failure = acknowledgementFailure.retryNotFound
              ? BrowserDeploymentPropagationError
              : Error
            throw new Failure(acknowledgementFailure.message)
          }
        }
        const readinessFailure = await Promise.race([
          waitForRouteReady(page).then(() => null),
          firstAssetFailure,
        ])
        if (readinessFailure) {
          const Failure = readinessFailure.retryNotFound
            ? BrowserDeploymentPropagationError
            : Error
          throw new Failure(readinessFailure.message)
        }
        await assertRouteDataHealthy(page, route)
        if (requirePagesDev && route === '/#/events') {
          await assertPreviewReadOnly(page)
        }
        assertSurfaceNavigation(
          response,
          page.url(),
          normalizedSurfaceOrigin,
          routeLabel,
          navigationOptions,
        )
        const routeViolations = await page.evaluate(() => {
          const violations = globalThis.__mikuPreviewCspViolations || []
          globalThis.__mikuPreviewCspViolations = []
          return violations
        })
        cspViolations.push(...routeViolations.map((violation) => ({ route, ...violation })))
        analyticsScriptSnapshots.push(await page.evaluate(() => Array.from(document.scripts, (script) => ({
          src: script.src,
          type: script.type,
          dataCfBeacon: script.getAttribute('data-cf-beacon'),
        }))))
      }
    } catch (error) {
      const state = await browserFailureState(page)
      const wrappedError = new Error([
        error instanceof Error ? error.message : String(error),
        `Browser bootstrap diagnostics: ${detail({
          assetFailures,
          pageErrors,
          state,
          url: page.url(),
        })}`,
      ].join('\n'), { cause: error })
      if (error?.code === BROWSER_DEPLOYMENT_PROPAGATION_ERROR_CODE) {
        wrappedError.code = BROWSER_DEPLOYMENT_PROPAGATION_ERROR_CODE
      }
      throw wrappedError
    }
    if (assetFailures.length > 0) {
      const Failure = firstAssetFailureState?.retryNotFound
        ? BrowserDeploymentPropagationError
        : Error
      throw new Failure(`Browser smoke asset failures:\n${assetFailures.join('\n')}`)
    }
    if (!isAnalyticsPreview || analyticsObservations.size > 0) {
      await new Promise((resolve) => {
        const timer = setTimeout(resolve, ANALYTICS_OBSERVATION_TIMEOUT_MS)
        notifyAnalytics = () => {
          const observations = [...analyticsObservations.values()]
          const failed = observations.some((item) => item.failure || item.kind.endsWith('-invalid') || item.kind === 'obsolete-google')
          const completed = observations.length > 0 && observations.every((item) => item.status !== undefined)
          const rumSeen = observations.some((item) => item.kind === 'cloudflare-rum' && item.status !== undefined)
          if (failed || (completed && rumSeen)) {
            clearTimeout(timer)
            resolve()
          }
        }
        notifyAnalytics()
      })
    }
    await assertReleaseMarker(
      context.request,
      normalizedSurfaceOrigin,
      normalizedReleaseId,
      surfaceLabel,
    )
    analyticsScriptSnapshots.push(await page.evaluate(() => Array.from(document.scripts, (script) => ({
      src: script.src, type: script.type, dataCfBeacon: script.getAttribute('data-cf-beacon'),
    }))))
    cspViolations.push(...await page.evaluate(() => globalThis.__mikuPreviewCspViolations || []))
    for (const scripts of analyticsScriptSnapshots) {
      assertCloudflareWebAnalyticsContract({
        cspViolations, isPreview: isAnalyticsPreview, observations: [...analyticsObservations.values()],
        scripts, surfaceOrigin: normalizedSurfaceOrigin,
      })
    }
    assertNoBrowserSecurityErrors({ cspViolations, pageErrors })

    return {
      callbackUrl: `${normalizedAppOrigin}/api/auth/github/callback`,
      consoleDiagnostics,
      releaseId: normalizedReleaseId,
      routes: [...BROWSER_SMOKE_ROUTES],
      surfaceLabel,
      surfaceOrigin: normalizedSurfaceOrigin,
    }
  } finally {
    signal?.removeEventListener('abort', abortBrowser)
    await browser.close()
  }
}

function formatConsoleDiagnostic(diagnostic) {
  const type = String(diagnostic?.type || 'log').replace(/[\r\n]+/g, ' ')
  const message = String(diagnostic?.text || '').replace(/[\r\n]+/g, ' ').slice(0, 500)
  return `  - [${type}] ${message}`
}

export function formatPreviewSmokeReport(report) {
  return [
    'Browser smoke: PASS',
    `- ${String(report.surfaceLabel || 'surface').toLowerCase()}: ${report.surfaceOrigin}`,
    `- release: ${report.releaseId}`,
    `- routes: ${report.routes.join(', ')}`,
    `- console diagnostics: ${report.consoleDiagnostics.length}`,
    ...report.consoleDiagnostics.map(formatConsoleDiagnostic),
    `- expected OAuth callback: ${report.callbackUrl}`,
  ].join('\n')
}

async function runCli() {
  const browserOrigin = process.env.BROWSER_SMOKE_ORIGIN
  const previewOrigin = process.env.PREVIEW_SMOKE_ORIGIN
  if (browserOrigin && previewOrigin && browserOrigin !== previewOrigin) {
    throw new Error('BROWSER_SMOKE_ORIGIN and PREVIEW_SMOKE_ORIGIN must not conflict')
  }
  const isPreview = !browserOrigin
  const report = await withDeploymentPropagationRetry(({ signal }) => runBrowserSmoke({
    appOrigin: process.env.APP_SMOKE_ORIGIN,
    dataManifestUrl: process.env.DATA_MANIFEST_URL,
    expectedReleaseId: process.env.EXPECTED_RELEASE_ID,
    requirePagesDev: isPreview,
    signal,
    surfaceLabel: isPreview ? 'Preview' : 'Production',
    surfaceOrigin: browserOrigin || previewOrigin,
  }))
  process.stdout.write(`${formatPreviewSmokeReport(report)}\n`)
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : ''
if (invokedPath === import.meta.url) {
  runCli().catch((error) => {
    process.stderr.write(
      `Browser smoke: FAIL\n${error instanceof Error ? error.message : String(error)}\n`,
    )
    process.exitCode = 1
  })
}
