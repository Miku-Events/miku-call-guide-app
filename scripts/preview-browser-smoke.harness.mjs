import assert from 'node:assert/strict'
import { createHash, randomBytes } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { chromium } from '@playwright/test'
import { assertBuiltArtifactResponse, runBrowserSmoke } from './preview-browser-smoke.mjs'
import { callGuideManifest, eventCalendarIndex, eventCalendarMayMonth, eventCalendarMonth, rootManifest, song } from '../tests/fixtures/data.ts'

const appOrigin = 'https://miku.sekai.today'
const manifestUrl = 'https://data.miku-events.dev/manifest.json'
const releaseId = randomBytes(20).toString('hex')
const publicToken = randomBytes(16).toString('hex')
const beaconUrl = 'https://static.cloudflareinsights.com/beacon.min.js'
const rumUrl = 'https://cloudflareinsights.com/cdn-cgi/rum'
const build = spawnSync('npm run build', {
  shell: true, windowsHide: true, encoding: 'utf8', timeout: 120_000,
  env: {
    ...process.env,
    VITE_APP_ORIGIN: appOrigin,
    VITE_DATA_MANIFEST_URL: manifestUrl,
    VITE_SUBMISSION_API_URL: '',
    VITE_RELEASE_ID: releaseId,
  },
})
assert.equal(build.status, 0, 'Current artifact build failed (build output withheld to protect environment values)')
const builtHtml = await readFile(new URL('../dist/index.html', import.meta.url))
const pagesHtml = Buffer.from(builtHtml.toString().replace('</body>', `<script defer src="${beaconUrl}" data-cf-beacon='${JSON.stringify({ token: publicToken })}'></script></body>`))
const builtHeaders = await readFile(new URL('../dist/_headers', import.meta.url), 'utf8')
const builtRelease = JSON.parse(await readFile(new URL('../dist/release.json', import.meta.url), 'utf8'))
assert.equal(builtRelease.releaseId, releaseId)
const staticHeaders = Object.fromEntries(builtHeaders.split('\n').filter((line) => /^  [A-Z]/.test(line)).map((line) => {
  const separator = line.indexOf(':')
  return [line.slice(2, separator).toLowerCase(), line.slice(separator + 1).trim()]
}))
const builtFiles = new Map([['/', builtHtml]])
for (const entry of await readdir(new URL('../dist/assets/', import.meta.url))) {
  builtFiles.set(`/assets/${entry}`, await readFile(new URL(`../dist/assets/${entry}`, import.meta.url)))
}
const assetHashes = new Map()
const contentTypes = { '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json' }
const datasets = new Map([
  ['/manifest.json', rootManifest],
  ['/call-guide-manifest.json', { ...callGuideManifest, songs: [{ ...callGuideManifest.songs[0], id: '39-music', path: 'songs/39-music.json' }] }],
  ['/songs/39-music.json', { ...song, id: '39-music' }],
  ['/event-calendar/index.json', eventCalendarIndex],
  ['/event-calendar/months/2026-05.json', eventCalendarMayMonth],
  ['/event-calendar/months/2026-06.json', eventCalendarMonth],
])
const scenarios = [
  ['production-success', false, null],
  ['preview-clean', true, null],
  ['preview-auto-injected', true, null],
  ['preview-network-attempt', true, /network failure/],
  ['rum-network-failure', false, /network failure/],
  ['rum-http-failure', false, /unsuccessful response/],
  ['rum-cors-failure', false, /network failure/],
  ['duplicate-script', false, /exactly one/],
  ['missing-script', false, /exactly one/],
  ['malformed-config', false, /configuration/],
  ['array-token-config', false, /configuration/],
  ['wrong-endpoint', false, /unexpected endpoint|CSP/],
  ['legacy-google', true, /obsolete Google/],
  ['beacon-network-failure', false, /network failure/],
  ['beacon-runtime-error', false, /page:.*provider fixture failure/],
  ['interrupted-1', false, /closed|interrupted/],
  ['interrupted-2', false, /closed|interrupted/],
]
const results = []
for (const [name, isPreview, expectedError] of scenarios) {
  const surfaceOrigin = isPreview ? 'https://12345678.smoke.pages.dev' : appOrigin
  const deliveredHtml = name === 'preview-clean' || name === 'legacy-google' ? builtHtml : pagesHtml
  const requests = []
  const navigation = []
  const responses = []
  const controller = new AbortController()
  const interrupted = name.startsWith('interrupted-')
  let closed = false
  let servedBuiltDocument = false
  let fixtureEventObserved = false
  const browserType = {
    async launch(options) {
      const browser = await chromium.launch(options)
      return {
        async close() { await browser.close(); closed = true },
        async newContext() {
          const context = await browser.newContext()
          if (name === 'legacy-google') {
            await context.addInitScript(({ source }) => {
              document.addEventListener('DOMContentLoaded', () => {
                const injected = document.createElement('script')
                injected.type = 'module'
                injected.src = source
                document.head.append(injected)
              })
            }, { source: name === 'legacy-google' ? 'https://www.googletagmanager.com/gtag/js' : beaconUrl })
          }
          await context.route('**/*', async (route) => {
            const url = new URL(route.request().url())
            requests.push({ method: route.request().method(), url: `${url.origin}${url.pathname}` })
            if (url.href === beaconUrl) {
              if (name === 'preview-network-attempt' || name === 'beacon-network-failure') return route.abort('failed')
              return route.fulfill({ contentType: 'text/javascript', headers: { 'access-control-allow-origin': '*' }, body: `
                const beacon = document.querySelector('script[src="${beaconUrl}"]');
                ${name === 'duplicate-script' ? 'document.head.append(beacon.cloneNode(true));' : ''}
                ${name === 'missing-script' ? 'beacon.remove();' : ''}
                ${name === 'malformed-config' ? 'beacon.dataset.cfBeacon = "malformed";' : ''}
                ${name === 'array-token-config' ? 'beacon.dataset.cfBeacon = JSON.stringify({ token: [JSON.parse(beacon.dataset.cfBeacon).token] });' : ''}
                const send = () => fetch('${name === 'wrong-endpoint' ? `${rumUrl}-wrong` : rumUrl}', { method: 'POST', body: '{}' }).catch(() => {});
                send(); addEventListener('hashchange', send);
                ${name === 'beacon-runtime-error' ? 'throw new Error("provider fixture failure");' : ''}
              ` })
            }
            if (url.origin === 'https://cloudflareinsights.com') {
              if (name === 'rum-network-failure') return route.abort('failed')
              return route.fulfill({ status: name === 'rum-http-failure' ? 503 : 200, contentType: 'application/json',
                headers: { 'access-control-allow-origin': name === 'rum-cors-failure' ? 'https://wrong-origin.invalid' : '*' }, body: '{}' })
            }
            if (url.origin === new URL(manifestUrl).origin) {
              assert.ok(datasets.has(url.pathname), `Unexpected data request: ${url.pathname}`)
              return route.fulfill({ json: datasets.get(url.pathname), headers: { 'access-control-allow-origin': '*' } })
            }
            if (url.pathname === '/api/auth/session') return route.fulfill({ json: { authenticated: false } })
            if (url.origin === surfaceOrigin) {
              assert.equal(url.pathname.includes('..'), false)
              assert.ok(builtFiles.has(url.pathname), `Unexpected app asset: ${url.pathname}`)
              const body = url.pathname === '/' ? deliveredHtml : builtFiles.get(url.pathname)
              if (url.pathname === '/') servedBuiltDocument = body.equals(deliveredHtml)
              if (url.pathname.startsWith('/assets/')) assetHashes.set(url.pathname, createHash('sha256').update(body).digest('hex'))
              const extension = url.pathname.match(/\.[a-z]+$/)?.[0]
              return route.fulfill({ body, headers: staticHeaders, contentType: contentTypes[extension] || 'text/html; charset=utf-8' })
            }
            if (url.hostname === 'fonts.googleapis.com') return route.fulfill({ body: '', contentType: 'text/css' })
            if (url.hostname === 'i.ytimg.com') return route.fulfill({ contentType: 'image/gif', body: Buffer.from('R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==', 'base64') })
            return route.abort('blockedbyclient')
          })
          return {
            async newPage() {
              const page = await context.newPage()
              await page.clock.setFixedTime(new Date('2026-06-15T12:00:00+09:00'))
              const waitForURL = page.waitForURL.bind(page)
              page.waitForURL = async (target, options) => {
                await waitForURL(target, options)
                if (new URL(page.url()).hash === '#/events') {
                  await page.locator('[data-date="2026-06-15"]').waitFor({ state: 'visible', timeout: 10_000 })
                  await page.getByRole('button', { name: /하츠네 미쿠 예습 샘플:/ }).waitFor({ state: 'visible', timeout: 10_000 })
                  fixtureEventObserved = true
                }
              }
              const goto = page.goto.bind(page)
              page.goto = async (target, options) => {
                const url = new URL(target)
                url.searchParams.set('mockPlayer', '1')
                const response = await goto(url.href, options)
                assertBuiltArtifactResponse(deliveredHtml, await response.body())
                if (interrupted) controller.abort(new Error('interrupted'))
                return response
              }
              page.on('requestfinished', (request) => {
                const url = new URL(request.url())
                if (url.href === beaconUrl || url.origin === 'https://cloudflareinsights.com') {
                  responses.push({ method: request.method(), url: `${url.origin}${url.pathname}`, completed: true })
                }
              })
              page.on('framenavigated', (frame) => { if (frame === page.mainFrame()) navigation.push(new URL(frame.url()).hash || '/') })
              return page
            },
            request: { async get(target) {
              assert.equal(new URL(target).pathname, '/release.json')
              return { status: () => 200, json: async () => builtRelease }
            } },
          }
        },
      }
    },
  }
  let errorMessage = ''
  try {
    await runBrowserSmoke({ appOrigin, browserType, dataManifestUrl: manifestUrl, expectedReleaseId: releaseId, requirePagesDev: isPreview, surfaceOrigin, signal: controller.signal })
  } catch (error) {
    errorMessage = error.message
  }
  assert.equal(closed, true, `${name}: browser cleanup`)
  if (expectedError) assert.match(errorMessage, expectedError, name)
  else assert.equal(errorMessage, '', name)
  assert.equal(servedBuiltDocument, true, `${name}: exact built HTML served`)
  assert.ok(requests.some((request) => request.url.includes('/assets/index-')), `${name}: actual Vite entry loaded`)
  const routeChanges = navigation.filter((route, index) => index === 0 || route !== navigation[index - 1])
  if (!interrupted) assert.deepEqual(routeChanges, ['/', '#/events', '/', '#/events', '#/', '#/songs/39-music'], `${name}: actual app navigation`)
  if (!interrupted) assert.equal(fixtureEventObserved, true, `${name}: real fixture event rendered`)
  assert.equal(errorMessage.includes(publicToken), false, `${name}: token redaction`)
  results.push({ name, passed: true, browserClosed: closed, builtDocument: servedBuiltDocument, fixtureEventObserved, navigation, responses, requestCount: requests.length, outcome: expectedError ? 'rejected' : 'accepted' })
}
assert.ok(assetHashes.size > 3, 'Real lazy-route assets loaded')
process.stdout.write(`${JSON.stringify({ harness: 'current Vite built artifact with Pages-style injection; real UI; provider/data requests intercepted', buildExitCode: build.status, buildCount: 1, indexSha256: createHash('sha256').update(builtHtml).digest('hex'), assetHashes: Object.fromEntries(assetHashes), results }, null, 2)}\n`)
