import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { chromium } from '@playwright/test'
import { canonicalProductionOrigin } from '../api/_production-hostname.js'
import {
  assertPreviewFunctionSecurityHeaders,
  assertPreviewStaticSecurityHeaders,
} from './post-deploy-smoke.mjs'

const FULL_SHA_PATTERN = /^[0-9a-f]{40}$/

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
  consoleErrors = [],
  cspViolations = [],
  pageErrors = [],
} = {}) {
  const failures = [
    ...cspViolations.map((value) => `CSP: ${detail(value)}`),
    ...consoleErrors.map((value) => `console: ${detail(value)}`),
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

async function assertPreviewFunctions(request, previewOrigin) {
  const sessionResponse = await request.get(`${previewOrigin}/api/auth/session`, {
    headers: { 'cache-control': 'no-cache' },
    maxRedirects: 0,
  })
  assertStatus(sessionResponse, 200, 'Preview session Function')
  assertPreviewFunctionSecurityHeaders(await responseHeaders(sessionResponse))
  const session = await sessionResponse.json()
  if (!session || typeof session.authenticated !== 'boolean') {
    throw new Error('Preview session Function returned an invalid contract')
  }

  const oauthResponse = await request.get(`${previewOrigin}/api/auth/github/start?returnTo=%2F`, {
    headers: { 'cache-control': 'no-cache' },
    maxRedirects: 0,
  })
  assertStatus(oauthResponse, 302, 'Preview OAuth start Function')
  assertPreviewFunctionSecurityHeaders(await responseHeaders(oauthResponse))
  const location = oauthResponse.headers().location || ''
  let authorization
  try {
    authorization = new URL(location)
  } catch {
    throw new Error('Preview OAuth start Function returned an invalid authorization URL')
  }
  if (
    authorization.origin !== 'https://github.com'
    || authorization.pathname !== '/login/oauth/authorize'
    || !authorization.searchParams.get('client_id')
    || !authorization.searchParams.get('state')
    || !authorization.searchParams.get('code_challenge')
    || authorization.searchParams.get('code_challenge_method') !== 'S256'
  ) {
    throw new Error('Preview OAuth start Function is missing the OAuth/PKCE contract')
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
    const consoleErrors = []
    const pageErrors = []
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text())
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

    const rootResponse = await page.goto(
      `${normalizedPreviewOrigin}/?preview-smoke=${encodeURIComponent(normalizedReleaseId)}`,
      { waitUntil: 'networkidle' },
    )
    if (!rootResponse) throw new Error('Preview root did not return a navigation response')
    assertStatus(rootResponse, 200, 'Preview root')
    assertPreviewStaticSecurityHeaders(await responseHeaders(rootResponse), {
      appOrigin: normalizedAppOrigin,
      dataOrigin: new URL(normalizedManifestUrl).origin,
      submissionOrigin: normalizedSubmissionUrl ? new URL(normalizedSubmissionUrl).origin : '',
    })
    await page.locator('main').first().waitFor({ state: 'visible' })
    await page.evaluate(() => new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(resolve))
    }))
    const cspViolations = await page.evaluate(() => globalThis.__mikuPreviewCspViolations || [])
    assertNoBrowserSecurityErrors({ consoleErrors, cspViolations, pageErrors })
    await assertReleaseMarker(context.request, normalizedPreviewOrigin, normalizedReleaseId)
    await assertPreviewFunctions(context.request, normalizedPreviewOrigin)

    return {
      callbackUrl: `${normalizedAppOrigin}/api/auth/github/callback`,
      previewOrigin: normalizedPreviewOrigin,
      releaseId: normalizedReleaseId,
    }
  } finally {
    await browser.close()
  }
}

function formatReport(report) {
  return [
    'Preview browser smoke: PASS',
    `- preview: ${report.previewOrigin}`,
    `- release: ${report.releaseId}`,
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
  process.stdout.write(`${formatReport(report)}\n`)
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
