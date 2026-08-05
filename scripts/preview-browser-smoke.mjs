import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { chromium } from '@playwright/test'
import { canonicalProductionOrigin } from '../functions/_lib/productionHostname.js'
import { assertStaticSecurityHeaders } from './post-deploy-smoke.mjs'

const FULL_SHA_PATTERN = /^[0-9a-f]{40}$/
export const PREVIEW_ROUTES = Object.freeze(['/', '/#/events', '/#/songs/39-music'])

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

function requiredOrigin(value, name, { canonical = false } = {}) {
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
  if (canonical && canonicalProductionOrigin(value) !== value) {
    throw new Error(`${name} must be an exact canonical HTTPS origin`)
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

export function assertNoBrowserSecurityErrors({
  cspViolations = [],
  pageErrors = [],
} = {}) {
  const failures = [
    ...cspViolations.map((value) => `CSP: ${detail(value)}`),
    ...pageErrors.map((value) => `page: ${detail(value)}`),
  ]
  if (failures.length > 0) {
    throw new Error(`Preview browser smoke blocked promotion:\n${failures.join('\n')}`)
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

async function assertReleaseMarker(request, previewOrigin, expectedReleaseId) {
  const response = await request.get(
    `${previewOrigin}/release.json?release=${encodeURIComponent(expectedReleaseId)}`,
    { headers: { 'cache-control': 'no-cache' } },
  )
  assertStatus(response, 200, 'Preview release marker')
  const marker = await response.json()
  if (
    !marker
    || typeof marker !== 'object'
    || Array.isArray(marker)
    || Object.keys(marker).length !== 1
    || marker.releaseId !== expectedReleaseId
  ) {
    throw new Error('Preview release marker does not match the requested commit SHA')
  }
}

export async function runPreviewBrowserSmoke({
  appOrigin,
  browserType = chromium,
  dataManifestUrl,
  expectedReleaseId,
  previewOrigin,
  submissionApiUrl = '',
} = {}) {
  const normalizedAppOrigin = requiredOrigin(appOrigin, 'APP_SMOKE_ORIGIN', { canonical: true })
  const normalizedPreviewOrigin = requiredOrigin(previewOrigin, 'PREVIEW_SMOKE_ORIGIN')
  if (!new URL(normalizedPreviewOrigin).hostname.endsWith('.pages.dev')) {
    throw new Error('PREVIEW_SMOKE_ORIGIN must use a pages.dev hostname')
  }
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
    page.on('console', (message) => {
      consoleDiagnostics.push({ type: message.type(), text: message.text() })
    })
    page.on('pageerror', (error) => pageErrors.push(error.message))
    await page.addInitScript(() => {
      globalThis.__mikuPreviewCspViolations = []
      document.addEventListener('securitypolicyviolation', (event) => {
        globalThis.__mikuPreviewCspViolations.push({
          blockedURI: event.blockedURI,
          disposition: event.disposition,
          effectiveDirective: event.effectiveDirective,
          sourceFile: event.sourceFile,
        })
      })
    })

    for (const [index, route] of PREVIEW_ROUTES.entries()) {
      const separator = route.includes('?') ? '&' : '?'
      const response = await page.goto(
        `${normalizedPreviewOrigin}${route}${separator}preview-smoke=${encodeURIComponent(normalizedReleaseId)}`,
        { waitUntil: 'domcontentloaded' },
      )
      if (index === 0) {
        if (!response) throw new Error('Preview root did not return a navigation response')
        assertStatus(response, 200, 'Preview root')
        assertStaticSecurityHeaders(await responseHeaders(response), {
          appOrigin: normalizedAppOrigin,
          dataOrigin: new URL(normalizedManifestUrl).origin,
          submissionOrigin: normalizedSubmissionUrl ? new URL(normalizedSubmissionUrl).origin : '',
        }, 'Preview root')
        await acknowledgeInitialSpoilerDisclaimer(page)
      }
      await waitForRouteReady(page)
      const routeViolations = await page.evaluate(() => {
        const violations = globalThis.__mikuPreviewCspViolations || []
        globalThis.__mikuPreviewCspViolations = []
        return violations
      })
      cspViolations.push(...routeViolations.map((violation) => ({ route, ...violation })))
    }
    assertNoBrowserSecurityErrors({ cspViolations, pageErrors })
    await assertReleaseMarker(context.request, normalizedPreviewOrigin, normalizedReleaseId)

    return {
      callbackUrl: `${normalizedAppOrigin}/api/auth/github/callback`,
      consoleDiagnostics,
      previewOrigin: normalizedPreviewOrigin,
      releaseId: normalizedReleaseId,
      routes: [...PREVIEW_ROUTES],
    }
  } finally {
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
    'Preview browser smoke: PASS',
    `- preview: ${report.previewOrigin}`,
    `- release: ${report.releaseId}`,
    `- routes: ${report.routes.join(', ')}`,
    `- console diagnostics: ${report.consoleDiagnostics.length}`,
    ...report.consoleDiagnostics.map(formatConsoleDiagnostic),
    `- expected OAuth callback: ${report.callbackUrl}`,
  ].join('\n')
}

async function runCli() {
  const report = await runPreviewBrowserSmoke({
    appOrigin: process.env.APP_SMOKE_ORIGIN,
    dataManifestUrl: process.env.DATA_MANIFEST_URL,
    expectedReleaseId: process.env.EXPECTED_RELEASE_ID,
    previewOrigin: process.env.PREVIEW_SMOKE_ORIGIN,
    submissionApiUrl: process.env.SUBMISSION_API_URL,
  })
  process.stdout.write(`${formatPreviewSmokeReport(report)}\n`)
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : ''
if (invokedPath === import.meta.url) {
  runCli().catch((error) => {
    process.stderr.write(
      `Preview browser smoke: FAIL\n${error instanceof Error ? error.message : String(error)}\n`,
    )
    process.exitCode = 1
  })
}
