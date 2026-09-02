import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { chromium } from '@playwright/test'
import { canonicalProductionOrigin } from '../functions/_lib/productionHostname.js'
import {
  assertStaticSecurityHeaders,
  requiredReleaseId,
} from './post-deploy-smoke.mjs'
import {
  GOOGLE_TAG_GATEWAY_MEASUREMENT_ID,
  GOOGLE_TAG_GATEWAY_PATH,
} from './static-csp-sources.mjs'

const DEFAULT_DEPLOYMENT_PROPAGATION_ATTEMPTS = 25
const DEFAULT_DEPLOYMENT_PROPAGATION_RETRY_DELAY_MS = 5_000
const DEFAULT_BROWSER_PROPAGATION_DEADLINE_MS = 120_000
const BROWSER_DEPLOYMENT_PROPAGATION_ERROR_CODE = 'BROWSER_DEPLOYMENT_PROPAGATION'
export const BROWSER_SMOKE_ROUTES = Object.freeze(['/', '/#/events', '/#/songs/39-music'])

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

export function isGoogleTagGatewayMeasurementResponse({
  method,
  postData = '',
  status,
  url: rawUrl,
}, surfaceOrigin) {
  let url
  try {
    url = new URL(rawUrl)
  } catch {
    return false
  }
  if (
    url.origin !== surfaceOrigin
    || !url.pathname.startsWith(GOOGLE_TAG_GATEWAY_PATH)
    || method !== 'POST'
    || status < 200
    || status >= 300
  ) {
    return false
  }
  const urlHasMeasurementId = url.searchParams.getAll('tid')
    .includes(GOOGLE_TAG_GATEWAY_MEASUREMENT_ID)
  const bodyHasMeasurementId = postData
    .split(/\r?\n/)
    .some((line) => new URLSearchParams(line).getAll('tid')
      .includes(GOOGLE_TAG_GATEWAY_MEASUREMENT_ID))
  return urlHasMeasurementId || bodyHasMeasurementId
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

async function runBrowserSmoke({
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
    let tagGatewayMeasurementSeen = false
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
      consoleDiagnostics.push({ type: message.type(), text: message.text() })
    })
    page.on('pageerror', (error) => pageErrors.push(error.message))
    page.on('response', (response) => {
      const request = response.request()
      if (isGoogleTagGatewayMeasurementResponse({
        method: request.method(),
        postData: request.postData() || '',
        status: response.status(),
        url: response.url(),
      }, normalizedSurfaceOrigin)) {
        tagGatewayMeasurementSeen = true
      }
      recordAssetFailure(
        appAssetFailure(response, normalizedSurfaceOrigin),
        response.status() === 404,
      )
    })
    page.on('requestfailed', (request) => {
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
        const response = await page.goto(
          `${normalizedSurfaceOrigin}${route}${separator}browser-smoke=${encodeURIComponent(normalizedReleaseId)}`,
          { waitUntil: 'domcontentloaded' },
        )
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
    assertNoBrowserSecurityErrors({ cspViolations, pageErrors })
    if (!requirePagesDev && !tagGatewayMeasurementSeen) {
      throw new Error(
        `Google Tag Gateway did not send a successful first-party measurement through ${GOOGLE_TAG_GATEWAY_PATH}`,
      )
    }
    await assertReleaseMarker(
      context.request,
      normalizedSurfaceOrigin,
      normalizedReleaseId,
      surfaceLabel,
    )

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
