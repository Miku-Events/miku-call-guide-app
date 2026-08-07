import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { chromium } from '@playwright/test'
import { canonicalProductionOrigin } from '../functions/_lib/productionHostname.js'
import { assertStaticSecurityHeaders } from './post-deploy-smoke.mjs'

const FULL_SHA_PATTERN = /^[0-9a-f]{40}$/
const DEFAULT_ASSET_PROPAGATION_ATTEMPTS = 8
const DEFAULT_ASSET_PROPAGATION_RETRY_DELAY_MS = 5_000
export const BROWSER_ASSET_DELIVERY_ERROR_CODE = 'BROWSER_ASSET_DELIVERY'
export const BROWSER_SMOKE_ROUTES = Object.freeze(['/', '/#/events', '/#/songs/39-music'])
export const PREVIEW_ROUTES = BROWSER_SMOKE_ROUTES

export function mainLandmarkLocator(page) {
  return page.getByRole('main')
}

export async function acknowledgeInitialSpoilerDisclaimer(page) {
  const dialog = page.getByRole('alertdialog', { name: '스포일러 안내' })

  await dialog.waitFor({ state: 'visible' })
  await dialog.getByRole('button', { name: '확인하고 계속하기' }).click()
  await dialog.waitFor({ state: 'detached' })
}

export async function waitForRouteReady(page) {
  await mainLandmarkLocator(page).waitFor({ state: 'visible' })
  await page.waitForFunction(() => {
    const main = document.querySelector('[role="main"], main')
    return Boolean(main)
      && !main.querySelector('[aria-busy="true"]')
      && !main.querySelector('.app-loading')
  })
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

function requiredUrl(value, name, { optional = false } = {}) {
  if (optional && !value) return ''
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

function requiredReleaseSha(value) {
  if (!FULL_SHA_PATTERN.test(value || '')) {
    throw new Error('EXPECTED_RELEASE_ID must be a full lowercase commit SHA')
  }
  return value
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

export class BrowserAssetDeliveryError extends Error {
  constructor(message, options) {
    super(message, options)
    this.name = 'BrowserAssetDeliveryError'
    this.code = BROWSER_ASSET_DELIVERY_ERROR_CODE
  }
}

export async function withAssetPropagationRetry(check, {
  attempts = DEFAULT_ASSET_PROPAGATION_ATTEMPTS,
  retryDelayMs = DEFAULT_ASSET_PROPAGATION_RETRY_DELAY_MS,
  waitImpl = wait,
} = {}) {
  if (!Number.isSafeInteger(attempts) || attempts < 1) {
    throw new Error('attempts must be at least 1')
  }

  let lastError
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await check()
    } catch (error) {
      lastError = error
      if (error?.code !== BROWSER_ASSET_DELIVERY_ERROR_CODE || attempt === attempts) {
        throw error
      }
    }
    if (retryDelayMs > 0) await waitImpl(retryDelayMs)
  }
  throw lastError
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

export function initialDocumentDeliveryFailure(response, label) {
  if (!response) return ''
  const status = response.status()
  if (status !== 404 && status < 500) return ''
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
  assertStatus(response, 200, `${label} release marker`)
  const marker = await response.json()
  if (
    !marker
    || typeof marker !== 'object'
    || Array.isArray(marker)
    || Object.keys(marker).length !== 1
    || marker.releaseId !== expectedReleaseId
  ) {
    throw new Error(`${label} release marker does not match the requested commit SHA`)
  }
}

export async function runBrowserSmoke({
  appOrigin,
  browserType = chromium,
  dataManifestUrl,
  expectedReleaseId,
  requirePagesDev = false,
  surfaceLabel = 'Browser surface',
  surfaceOrigin,
  submissionApiUrl = '',
} = {}) {
  const normalizedAppOrigin = requiredOrigin(appOrigin, 'APP_SMOKE_ORIGIN')
  const normalizedSurfaceOrigin = requiredOrigin(
    surfaceOrigin,
    'BROWSER_SMOKE_ORIGIN',
    { requirePagesDev },
  )
  const normalizedManifestUrl = requiredUrl(dataManifestUrl, 'DATA_MANIFEST_URL')
  const normalizedSubmissionUrl = requiredUrl(
    submissionApiUrl,
    'SUBMISSION_API_URL',
    { optional: true },
  )
  const normalizedReleaseId = requiredReleaseSha(expectedReleaseId)
  const browser = await browserType.launch({ headless: true })
  try {
    const context = await browser.newContext()
    const page = await context.newPage()
    const consoleDiagnostics = []
    const cspViolations = []
    const pageErrors = []
    const assetFailures = []
    let resolveFirstAssetFailure
    const firstAssetFailure = new Promise((resolve) => {
      resolveFirstAssetFailure = resolve
    })
    const recordAssetFailure = (failure) => {
      if (!failure || assetFailures.includes(failure)) return
      assetFailures.push(failure)
      if (assetFailures.length === 1) resolveFirstAssetFailure(failure)
    }
    page.on('console', (message) => {
      consoleDiagnostics.push({ type: message.type(), text: message.text() })
    })
    page.on('pageerror', (error) => pageErrors.push(error.message))
    page.on('response', (response) => {
      recordAssetFailure(appAssetFailure(response, normalizedSurfaceOrigin))
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
          throw new BrowserAssetDeliveryError(initialDeliveryFailure)
        }
        assertSurfaceNavigation(
          response,
          page.url(),
          normalizedSurfaceOrigin,
          routeLabel,
          navigationOptions,
        )
        if (index === 0) {
          assertStaticSecurityHeaders(await responseHeaders(response), {
            appOrigin: normalizedAppOrigin,
            dataOrigin: new URL(normalizedManifestUrl).origin,
            submissionOrigin: normalizedSubmissionUrl ? new URL(normalizedSubmissionUrl).origin : '',
          }, `${surfaceLabel} root`)
          const acknowledgementFailure = await Promise.race([
            acknowledgeInitialSpoilerDisclaimer(page).then(() => ''),
            firstAssetFailure,
          ])
          if (acknowledgementFailure) {
            throw new BrowserAssetDeliveryError(acknowledgementFailure)
          }
        }
        const readinessFailure = await Promise.race([
          waitForRouteReady(page).then(() => ''),
          firstAssetFailure,
        ])
        if (readinessFailure) throw new BrowserAssetDeliveryError(readinessFailure)
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
      if (error?.code === BROWSER_ASSET_DELIVERY_ERROR_CODE) {
        wrappedError.code = BROWSER_ASSET_DELIVERY_ERROR_CODE
      }
      throw wrappedError
    }
    if (assetFailures.length > 0) {
      throw new BrowserAssetDeliveryError(
        `Browser smoke asset failures:\n${assetFailures.join('\n')}`,
      )
    }
    assertNoBrowserSecurityErrors({ cspViolations, pageErrors })
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
    await browser.close()
  }
}

export function runPreviewBrowserSmoke({ previewOrigin, ...options } = {}) {
  return runBrowserSmoke({
    ...options,
    requirePagesDev: true,
    surfaceLabel: 'Preview',
    surfaceOrigin: previewOrigin,
  })
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
  const report = await withAssetPropagationRetry(() => runBrowserSmoke({
    appOrigin: process.env.APP_SMOKE_ORIGIN,
    dataManifestUrl: process.env.DATA_MANIFEST_URL,
    expectedReleaseId: process.env.EXPECTED_RELEASE_ID,
    requirePagesDev: isPreview,
    surfaceLabel: isPreview ? 'Preview' : 'Production',
    surfaceOrigin: browserOrigin || previewOrigin,
    submissionApiUrl: process.env.SUBMISSION_API_URL,
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
