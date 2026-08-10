import { describe, expect, it, vi } from 'vitest'
import {
  assertFunctionSecurityHeaders,
  assertStaticSecurityHeaders,
  DeploymentPropagationError,
  fetchWithTimeout,
  requiredReleaseId,
  runPostDeploySmoke,
  withPropagationRetry,
} from './post-deploy-smoke.mjs'

const appOrigin = 'https://app.miku-events.dev'
const deploymentOrigin = 'https://01234567.miku-call-guide-app.pages.dev'
const productionAliasOrigin = 'https://miku-call-guide-app.pages.dev'
const manifestUrl = 'https://data.miku-events.dev/manifest.json'
const releaseId = '0123456789abcdef0123456789abcdef01234567'
const dataVersion = '20260713T0000'
const generatedAt = '2026-07-13T00:00:00.000Z'
const callGuideManifestUrl = 'https://data.miku-events.dev/call-guide-manifest.json'
const songUrl = `https://data.miku-events.dev/songs/smoke-song.json?_miku_data_version=${dataVersion}`
const eventIndexUrl = 'https://data.miku-events.dev/event-calendar/index.json'
const emptyEventMonthUrl = 'https://data.miku-events.dev/event-calendar/months/2026-09.json'
const eventMonthUrl = 'https://data.miku-events.dev/event-calendar/months/2026-08.json'
const eventDetailUrl = `https://data.miku-events.dev/event-calendar/events/smoke-event.json?_miku_data_version=${dataVersion}`
const readinessContractHeader = 'x-miku-readiness-contract'
const readinessContractVersion = 'runtime-config-v2'
const staticSecurityHeaders = {
  'cache-control': 'no-cache, no-transform',
  'content-security-policy': [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "connect-src 'self' https://data.miku-events.dev https://challenges.cloudflare.com https://www.youtube.com https://www.youtube-nocookie.com https://platform.x.com https://platform.twitter.com https://syndication.twitter.com https://cdn.syndication.twimg.com",
    "script-src 'self' https://challenges.cloudflare.com https://www.youtube.com https://s.ytimg.com https://platform.x.com https://platform.twitter.com https://syndication.twitter.com https://cdn.syndication.twimg.com",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: blob: https://i.ytimg.com https://img.youtube.com https://pbs.twimg.com https://abs.twimg.com",
    "frame-src https://challenges.cloudflare.com https://www.youtube.com https://www.youtube-nocookie.com https://platform.x.com https://platform.twitter.com https://syndication.twitter.com https://cdn.syndication.twimg.com",
    `form-action 'self' ${appOrigin}`,
    "manifest-src 'self'",
  ].join('; '),
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'strict-transport-security': 'max-age=31536000',
  'x-content-type-options': 'nosniff',
}
const functionSecurityHeaders = {
  'content-security-policy': "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'strict-transport-security': 'max-age=31536000',
  [readinessContractHeader]: readinessContractVersion,
  'x-content-type-options': 'nosniff',
}
const cspContext = {
  appOrigin,
  dataOrigin: new URL(manifestUrl).origin,
}

function releaseMarkerUrl(origin) {
  return `${origin}/release.json?release=${encodeURIComponent(releaseId)}`
}

function scriptUrl(origin) {
  return `${origin}/assets/index-smoke.js`
}

function stylesheetUrl(origin) {
  return `${origin}/assets/index-smoke.css`
}

function missingAssetUrl(origin) {
  return `${origin}/assets/__missing-${encodeURIComponent(releaseId)}.js`
}

function responseHeaders(values = {}, cookies = []) {
  const headers = new Headers({ ...functionSecurityHeaders, ...values })
  for (const cookie of cookies) headers.append('set-cookie', cookie)
  return headers
}

function aliasSmokeUrl() {
  return `${productionAliasOrigin}/api/ready?alias-smoke=${encodeURIComponent(releaseId)}`
}

function oauthStartUrl(origin) {
  return `${origin}/api/auth/github/start?returnTo=${encodeURIComponent(`${origin}/#/events`)}`
}

const validOauthCookie = '__Host-miku_call_guide_oauth=signed; Path=/; HttpOnly; SameSite=Lax; Max-Age=600; Secure'
const validLogoutCookies = [
  '__Host-miku_call_guide_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0; Secure',
  'miku_call_guide_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0',
  '__Host-miku_call_guide_oauth=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Secure',
  'miku_call_guide_oauth=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0',
]

function oauthStartResponse(cookie = validOauthCookie) {
  const location = new URL('https://github.com/login/oauth/authorize')
  location.searchParams.set('client_id', 'smoke-client')
  location.searchParams.set('redirect_uri', `${appOrigin}/api/auth/github/callback`)
  location.searchParams.set('state', 's'.repeat(43))
  location.searchParams.set('code_challenge', 'c'.repeat(43))
  location.searchParams.set('code_challenge_method', 'S256')
  return new Response(null, {
    headers: responseHeaders({ location: location.href }, [cookie]),
    status: 302,
  })
}

function logoutResponse(cookies = validLogoutCookies) {
  return new Response(null, {
    headers: responseHeaders({}, cookies),
    status: 204,
  })
}

function successfulResponse(url) {
  if (url === `${appOrigin}/` || url === `${deploymentOrigin}/`) {
    return new Response([
      '<!doctype html>',
      `<link rel="canonical" href="${appOrigin}/">`,
      '<link rel="stylesheet" href="https://fonts.googleapis.com/css?family=Outfit">',
      '<link rel="stylesheet" href="/assets/index-smoke.css">',
      '<script type="module" src="/assets/index-smoke.js"></script>',
    ].join('\n'), {
      headers: staticSecurityHeaders,
      status: 200,
    })
  }
  if (url === releaseMarkerUrl(appOrigin) || url === releaseMarkerUrl(deploymentOrigin)) {
    return Response.json({ releaseId })
  }
  if (url === scriptUrl(appOrigin) || url === scriptUrl(deploymentOrigin)) {
    return new Response('export {}', {
      headers: { 'content-type': 'text/javascript; charset=utf-8' },
      status: 200,
    })
  }
  if (url === stylesheetUrl(appOrigin) || url === stylesheetUrl(deploymentOrigin)) {
    return new Response('body {}', {
      headers: { 'content-type': 'text/css; charset=utf-8' },
      status: 200,
    })
  }
  if (url === missingAssetUrl(appOrigin) || url === missingAssetUrl(deploymentOrigin)) {
    return new Response('<!doctype html><title>Not found</title>', {
      headers: { 'content-type': 'text/html; charset=utf-8' },
      status: 404,
    })
  }
  if (url === `${appOrigin}/api/ready` || url === `${deploymentOrigin}/api/ready`) {
    return Response.json({ ready: true }, {
      headers: functionSecurityHeaders,
      status: 200,
    })
  }
  if (url === aliasSmokeUrl()) {
    return new Response(null, {
      headers: {
        location: `${appOrigin}/api/ready?alias-smoke=${encodeURIComponent(releaseId)}`,
      },
      status: 308,
    })
  }
  if (url === oauthStartUrl(appOrigin)) {
    return oauthStartResponse()
  }
  if (url === `${appOrigin}/api/auth/logout`) {
    return logoutResponse()
  }
  if (
    url === `${deploymentOrigin}/api/auth/github/start`
    || url === `${deploymentOrigin}/api/auth/logout`
  ) {
    return Response.json(
      { error: 'invalid_request_origin', requestId: 'immutable-request-1' },
      { headers: responseHeaders(), status: 403 },
    )
  }
  if (url === `${appOrigin}/og-image.png`) {
    return new Response(new Uint8Array(12_000), {
      headers: { 'content-type': 'image/png' },
      status: 200,
    })
  }
  if (url === manifestUrl) {
    return Response.json({
      schemaVersion: 1,
      generatedAt,
      dataVersion,
      manifests: {
        callGuide: 'call-guide-manifest.json',
        eventCalendar: 'event-calendar/index.json',
      },
    })
  }
  if (url === callGuideManifestUrl) {
    return Response.json({
      schemaVersion: 1,
      generatedAt,
      dataVersion,
      songs: [{
        id: 'smoke-song',
        title: { ko: '스모크 곡' },
        artist: { ko: '스모크 작곡가' },
        youtubeVideoId: 'M7lc1UVf-VE',
        tags: ['smoke'],
        path: 'songs/smoke-song.json',
        status: 'published',
      }],
    })
  }
  if (url === songUrl) {
    return Response.json({
      schemaVersion: 1,
      dataVersion,
      id: 'smoke-song',
      status: 'published',
      metadata: {
        title: { ko: '스모크 곡' },
        artist: { ko: '스모크 작곡가' },
        vocal: ['hatsune-miku'],
        tags: ['smoke'],
      },
      youtube: { videoId: 'M7lc1UVf-VE', startOffsetMs: 0 },
      display: {
        defaultLyricsLanguage: 'ja',
        defaultPronunciationLanguage: 'koPronunciation',
        defaultCallLanguage: 'ko',
      },
      timing: { unit: 'ms', durationMs: 6_000 },
      lyrics: [{
        id: 'line-001',
        time: '00:00:00,000 --> 00:00:06,000',
        text: { ja: '光るステージへ' },
        startMs: 0,
        endMs: 6_000,
      }],
      callEvents: [],
    })
  }
  if (url === eventIndexUrl) {
    return Response.json({
      schemaVersion: 1,
      generatedAt,
      dataVersion,
      availableMonths: ['2026-08', '2026-09'],
      types: ['concert'],
      typePriority: ['concert'],
    })
  }
  if (url === emptyEventMonthUrl) {
    return Response.json({
      schemaVersion: 1,
      generatedAt,
      dataVersion,
      month: '2026-09',
      events: [],
    })
  }
  if (url === eventMonthUrl) {
    return Response.json({
      schemaVersion: 1,
      generatedAt,
      dataVersion,
      month: '2026-08',
      events: [{
        id: 'smoke-event',
        title: { ko: '스모크 이벤트' },
        type: 'concert',
        occurrences: [{ id: 'main', startsOn: '2026-08-10', timezone: 'Asia/Seoul' }],
        path: '../events/smoke-event.json',
      }],
    })
  }
  if (url === eventDetailUrl) {
    return Response.json({
      schemaVersion: 1,
      dataVersion,
      id: 'smoke-event',
      status: 'published',
      title: { ko: '스모크 이벤트' },
      type: 'concert',
      occurrences: [{ id: 'main', startsOn: '2026-08-10', timezone: 'Asia/Seoul' }],
      links: { sns: [{ platform: 'x', url: 'https://x.com/example/status/1' }] },
    })
  }
  throw new Error(`Unexpected URL: ${url}`)
}

function smokeOptions(overrides = {}) {
  return {
    appOrigin,
    attempts: 1,
    dataManifestUrl: manifestUrl,
    deploymentOrigin,
    expectedReleaseId: releaseId,
    retryDelayMs: 0,
    ...overrides,
  }
}

describe('release marker input', () => {
  it('accepts only a full lowercase commit SHA', () => {
    expect(requiredReleaseId(releaseId)).toBe(releaseId)
    expect(() => requiredReleaseId('')).toThrow('EXPECTED_RELEASE_ID is required')
    expect(() => requiredReleaseId('A'.repeat(40))).toThrow('full lowercase commit SHA')
  })
})

describe('enforced response security headers', () => {
  it('accepts enforced static and Function CSP with the common headers', () => {
    expect(() => assertStaticSecurityHeaders(
      new Headers(staticSecurityHeaders),
      cspContext,
    )).not.toThrow()
    expect(() => assertFunctionSecurityHeaders(
      new Headers(functionSecurityHeaders),
    )).not.toThrow()
  })

  it('allows additional hardening directives while keeping required static sources exact', () => {
    const headers = new Headers({
      ...staticSecurityHeaders,
      'content-security-policy': `${staticSecurityHeaders['content-security-policy']}; upgrade-insecure-requests; block-all-mixed-content`,
    })

    expect(() => assertStaticSecurityHeaders(headers, cspContext)).not.toThrow()
  })

  it('allows additional hardening directives while keeping required Function sources exact', () => {
    const headers = new Headers({
      ...functionSecurityHeaders,
      'content-security-policy': `${functionSecurityHeaders['content-security-policy']}; upgrade-insecure-requests; block-all-mixed-content`,
    })

    expect(() => assertFunctionSecurityHeaders(headers)).not.toThrow()
  })

  it.each(['static', 'Function'])(
    'rejects a script-src-elem override in %s CSP',
    (profile) => {
      const base = profile === 'static' ? staticSecurityHeaders : functionSecurityHeaders
      const headers = new Headers({
        ...base,
        'content-security-policy': `${base['content-security-policy']}; script-src-elem https://evil.example`,
      })

      expect(() => (
        profile === 'static'
          ? assertStaticSecurityHeaders(headers, cspContext)
          : assertFunctionSecurityHeaders(headers)
      )).toThrow(/unexpected directive.*script-src-elem/i)
    },
  )

  it.each([
    'script-src-attr',
    'style-src-elem',
    'style-src-attr',
    'worker-src',
    'child-src',
  ])('rejects unsupported extra directive %s', (directive) => {
    const headers = new Headers({
      ...staticSecurityHeaders,
      'content-security-policy': `${staticSecurityHeaders['content-security-policy']}; ${directive} 'none'`,
    })

    expect(() => assertStaticSecurityHeaders(headers, cspContext))
      .toThrow(new RegExp(`unexpected directive ${directive}`, 'i'))
  })

  it.each(['static', 'Function'])(
    'rejects a value on an allowed extra hardening directive in %s CSP',
    (profile) => {
      const base = profile === 'static' ? staticSecurityHeaders : functionSecurityHeaders
      const headers = new Headers({
        ...base,
        'content-security-policy': `${base['content-security-policy']}; upgrade-insecure-requests https://evil.example`,
      })

      expect(() => (
        profile === 'static'
          ? assertStaticSecurityHeaders(headers, cspContext)
          : assertFunctionSecurityHeaders(headers)
      )).toThrow(/unexpected directive.*upgrade-insecure-requests/i)
    },
  )

  it.each([
    ['static', {
      ...staticSecurityHeaders,
      'content-security-policy': staticSecurityHeaders['content-security-policy'].replace(
        "script-src 'self'",
        "script-src 'self' https://unapproved.miku-events.dev",
      ),
    }],
    ['Function', {
      ...functionSecurityHeaders,
      'content-security-policy': "default-src 'none' https://unapproved.miku-events.dev; frame-ancestors 'none'; base-uri 'none'",
    }],
  ])('still rejects an extra source in a required %s directive', (profile, values) => {
    const headers = new Headers(values)
    expect(() => (
      profile === 'static'
        ? assertStaticSecurityHeaders(headers, cspContext)
        : assertFunctionSecurityHeaders(headers)
    )).toThrow(/allowlist/i)
  })

  it.each([
    ['a report-only static CSP', {
      ...staticSecurityHeaders,
      'content-security-policy': undefined,
      'content-security-policy-report-only': staticSecurityHeaders['content-security-policy'],
    }, 'static'],
    ['a report-only Function CSP', {
      ...functionSecurityHeaders,
      'content-security-policy': undefined,
      'content-security-policy-report-only': functionSecurityHeaders['content-security-policy'],
    }, 'function'],
    ['missing HSTS', {
      ...staticSecurityHeaders,
      'strict-transport-security': '',
    }, 'static'],
  ])('rejects %s', (_label, values, profile) => {
    const headers = new Headers(
      Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined)),
    )
    expect(() => (
      profile === 'static'
        ? assertStaticSecurityHeaders(headers, cspContext)
        : assertFunctionSecurityHeaders(headers)
    )).toThrow()
  })
})

describe('post-deploy smoke', () => {
  it('checks the exact release and runtime-config readiness without a caller origin header', async () => {
    const fetchMock = vi.fn(async (url) => successfulResponse(String(url)))

    const report = await runPostDeploySmoke(smokeOptions({ fetchImpl: fetchMock }))

    expect(new Set(fetchMock.mock.calls.map(([url]) => String(url)))).toEqual(new Set([
      `${deploymentOrigin}/`,
      scriptUrl(deploymentOrigin),
      stylesheetUrl(deploymentOrigin),
      missingAssetUrl(deploymentOrigin),
      releaseMarkerUrl(deploymentOrigin),
      `${deploymentOrigin}/api/ready`,
      `${appOrigin}/`,
      scriptUrl(appOrigin),
      stylesheetUrl(appOrigin),
      missingAssetUrl(appOrigin),
      releaseMarkerUrl(appOrigin),
      `${appOrigin}/api/ready`,
      aliasSmokeUrl(),
      oauthStartUrl(appOrigin),
      `${appOrigin}/api/auth/logout`,
      `${deploymentOrigin}/api/auth/github/start`,
      `${deploymentOrigin}/api/auth/logout`,
      `${appOrigin}/og-image.png`,
      manifestUrl,
      callGuideManifestUrl,
      songUrl,
      eventIndexUrl,
      emptyEventMonthUrl,
      eventMonthUrl,
      eventDetailUrl,
    ]))
    expect(report).toMatchObject({
      alias: {
        location: `${appOrigin}/api/ready?alias-smoke=${releaseId}`,
        origin: productionAliasOrigin,
        status: 308,
      },
      app: {
        assets: [{ kind: 'JavaScript' }, { kind: 'CSS' }],
        canonical: `${appOrigin}/`,
        missingAsset: { status: 404 },
        releaseId,
      },
      auth: {
        immutableLogoutStatus: 403,
        immutableOauthStatus: 403,
        logoutStatus: 204,
        oauthStatus: 302,
      },
      data: {
        dataVersion,
        eventId: 'smoke-event',
        month: '2026-08',
        schemaVersion: 1,
        songId: 'smoke-song',
      },
      deployment: {
        assets: [{ kind: 'JavaScript' }, { kind: 'CSS' }],
        missingAsset: { status: 404 },
        origin: deploymentOrigin,
        releaseId,
      },
      readiness: { app: 200, deployment: 200 },
      ogImage: { bytes: 12_000 },
    })
    const readinessCalls = fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/api/ready'))
    expect(readinessCalls).toHaveLength(2)
    for (const [, init] of readinessCalls) {
      expect(new Headers(init?.headers).has('x-miku-expected-app-origin')).toBe(false)
    }
    const surfaceCalls = fetchMock.mock.calls.filter(([url]) => (
      new URL(String(url)).origin !== new URL(manifestUrl).origin
    ))
    expect(surfaceCalls).not.toHaveLength(0)
    for (const [, init] of surfaceCalls) {
      expect(init?.redirect).toBe('manual')
    }
    const logoutCalls = fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/api/auth/logout'))
    expect(logoutCalls).toHaveLength(2)
    for (const [, init] of logoutCalls) {
      expect(init?.method).toBe('POST')
      expect(new Headers(init?.headers).get('origin')).toBe(appOrigin)
    }
  })

  it('rejects a redirect from the configured app surface', async () => {
    const fetchMock = vi.fn(async (url) => (
      String(url) === `${appOrigin}/`
        ? new Response(null, {
          headers: { location: 'https://miku-call-guide-app.pages.dev/' },
          status: 308,
        })
        : successfulResponse(String(url))
    ))

    await expect(runPostDeploySmoke(smokeOptions({ fetchImpl: fetchMock })))
      .rejects.toThrow(/Configured app root.*308/i)
    const appCall = fetchMock.mock.calls.find(([url]) => String(url) === `${appOrigin}/`)
    expect(appCall?.[1]?.redirect).toBe('manual')
  })

  it('requires the production pages.dev alias to preserve path and query', async () => {
    const fetchMock = vi.fn(async (url) => (
      String(url) === aliasSmokeUrl()
        ? new Response(null, {
          headers: { location: `${appOrigin}/` },
          status: 308,
        })
        : successfulResponse(String(url))
    ))

    await expect(runPostDeploySmoke(smokeOptions({ fetchImpl: fetchMock })))
      .rejects.toThrow(/alias must redirect/i)
  })

  it('requires immutable deployment auth and logout to fail closed', async () => {
    const fetchMock = vi.fn(async (url) => (
      String(url) === `${deploymentOrigin}/api/auth/github/start`
        ? Response.json({ authenticated: false }, {
          headers: responseHeaders(),
          status: 200,
        })
        : successfulResponse(String(url))
    ))

    await expect(runPostDeploySmoke(smokeOptions({ fetchImpl: fetchMock })))
      .rejects.toThrow(/Immutable OAuth rejection.*200/i)
  })

  it.each([
    ['Secure', validOauthCookie.replace('; Secure', '')],
    ['HttpOnly', validOauthCookie.replace('; HttpOnly', '')],
    ['Path=/', validOauthCookie.replace('; Path=/', '')],
    ['host-only scope', `${validOauthCookie}; Domain=miku.sekai.today`],
  ])('requires the live OAuth cookie to preserve %s', async (_attribute, invalidCookie) => {
    const fetchMock = vi.fn(async (url) => (
      String(url) === oauthStartUrl(appOrigin)
        ? oauthStartResponse(invalidCookie)
        : successfulResponse(String(url))
    ))

    await expect(runPostDeploySmoke(smokeOptions({ fetchImpl: fetchMock })))
      .rejects.toThrow(/secure transaction cookie/i)
  })

  it('requires every live logout cookie to use Path=/ and host-only scope', async () => {
    const invalidCookies = validLogoutCookies.map((cookie, index) => (
      index === 0 ? cookie.replace('; Path=/', '; Domain=miku.sekai.today') : cookie
    ))
    const fetchMock = vi.fn(async (url) => (
      String(url) === `${appOrigin}/api/auth/logout`
        ? logoutResponse(invalidCookies)
        : successfulResponse(String(url))
    ))

    await expect(runPostDeploySmoke(smokeOptions({ fetchImpl: fetchMock })))
      .rejects.toThrow(/did not clear __Host-miku_call_guide_session/i)
  })

  it('rejects a mismatched representative data leaf', async () => {
    const fetchMock = vi.fn(async (url) => (
      String(url) === eventDetailUrl
        ? Response.json({
          schemaVersion: 1,
          dataVersion: 'stale',
          id: 'smoke-event',
          status: 'published',
          title: { ko: '스모크 이벤트' },
          type: 'concert',
          occurrences: [{ id: 'main', startsOn: '2026-08-10', timezone: 'Asia/Seoul' }],
          links: { sns: [{ platform: 'x', url: 'https://x.com/example/status/1' }] },
        })
        : successfulResponse(String(url))
    ))

    await expect(runPostDeploySmoke(smokeOptions({ fetchImpl: fetchMock })))
      .rejects.toThrow(/event detail dataVersion/i)
  })

  it('rejects a representative child that violates the vendored data contract', async () => {
    const fetchMock = vi.fn(async (url) => (
      String(url) === callGuideManifestUrl
        ? Response.json({
          schemaVersion: 1,
          generatedAt,
          dataVersion,
          songs: [{ id: 'smoke-song', path: 'songs/smoke-song.json' }],
        })
        : successfulResponse(String(url))
    ))

    await expect(runPostDeploySmoke(smokeOptions({ fetchImpl: fetchMock })))
      .rejects.toThrow(/Call-guide manifest failed data contract validation/i)
  })

  it.each([
    ['JavaScript', scriptUrl(appOrigin), 'text/html'],
    ['CSS', stylesheetUrl(appOrigin), 'text/html'],
  ])('rejects an HTML fallback for the configured %s asset', async (
    _kind,
    failedUrl,
    contentType,
  ) => {
    const fetchMock = vi.fn(async (url) => (
      String(url) === failedUrl
        ? new Response('<!doctype html>', {
          headers: { 'content-type': contentType },
          status: 200,
        })
        : successfulResponse(String(url))
    ))

    await expect(runPostDeploySmoke(smokeOptions({ fetchImpl: fetchMock })))
      .rejects.toThrow(/asset.*text\/html/i)
  })

  it('rejects a root document without emitted JavaScript and CSS assets', async () => {
    const fetchMock = vi.fn(async (url) => (
      String(url) === `${deploymentOrigin}/`
        ? new Response(`<link rel="canonical" href="${appOrigin}/">`, {
          headers: staticSecurityHeaders,
          status: 200,
        })
        : successfulResponse(String(url))
    ))

    await expect(runPostDeploySmoke(smokeOptions({ fetchImpl: fetchMock })))
      .rejects.toThrow(/missing its module entry asset/i)
  })

  it('rejects an HTML document without cache-control transform protection', async () => {
    const fetchMock = vi.fn(async (url) => (
      String(url) === `${appOrigin}/`
        ? new Response([
          `<link rel="canonical" href="${appOrigin}/">`,
          '<link rel="stylesheet" href="/assets/index-smoke.css">',
          '<script type="module" src="/assets/index-smoke.js"></script>',
        ].join('\n'), {
          headers: {
            ...staticSecurityHeaders,
            'cache-control': 'no-cache',
          },
          status: 200,
        })
        : successfulResponse(String(url))
    ))

    await expect(runPostDeploySmoke(smokeOptions({ fetchImpl: fetchMock })))
      .rejects.toThrow(/cache-control: no-cache, no-transform/i)
  })

  it('rejects a successful HTML fallback for a missing fingerprint asset', async () => {
    const fetchMock = vi.fn(async (url) => (
      String(url) === missingAssetUrl(appOrigin)
        ? new Response('<!doctype html>', {
          headers: { 'content-type': 'text/html' },
          status: 200,
        })
        : successfulResponse(String(url))
    ))

    await expect(runPostDeploySmoke(smokeOptions({ fetchImpl: fetchMock })))
      .rejects.toThrow(/missing fingerprint asset.*200/i)
  })

  it('rejects a healthy previous release instead of producing a false positive', async () => {
    const fetchMock = vi.fn(async (url) => (
      String(url) === releaseMarkerUrl(appOrigin)
        ? Response.json({ releaseId: 'previous-release' })
        : successfulResponse(String(url))
    ))

    await expect(runPostDeploySmoke(smokeOptions({ attempts: 2, fetchImpl: fetchMock })))
      .rejects.toThrow(/release.*mismatch/i)
    expect(fetchMock.mock.calls.filter(([url]) => String(url) === releaseMarkerUrl(appOrigin)))
      .toHaveLength(2)
  })

  it('requires a successful JSON readiness response with the runtime-config contract', async () => {
    const unreadyFetch = vi.fn(async (url) => (
      String(url) === `${deploymentOrigin}/api/ready`
        ? Response.json({ error: 'service_not_ready', requestId: 'request-1' }, {
          headers: functionSecurityHeaders,
          status: 503,
        })
        : successfulResponse(String(url))
    ))
    await expect(runPostDeploySmoke(smokeOptions({ fetchImpl: unreadyFetch })))
      .rejects.toThrow(/readiness.*503/i)

    const missingContractFetch = vi.fn(async (url) => {
      if (String(url) === `${deploymentOrigin}/api/ready`) {
        const headers = { ...functionSecurityHeaders }
        delete headers[readinessContractHeader]
        return Response.json({ ready: true }, { headers, status: 200 })
      }
      return successfulResponse(String(url))
    })
    await expect(runPostDeploySmoke(smokeOptions({ fetchImpl: missingContractFetch })))
      .rejects.toThrow(/readiness.*contract/i)
  })

  it.each([
    ['a wildcard script source', {
      ...staticSecurityHeaders,
      'content-security-policy': "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; script-src *",
    }, /wildcard/i],
    ['unsafe-eval', {
      ...staticSecurityHeaders,
      'content-security-policy': `${staticSecurityHeaders['content-security-policy']} 'unsafe-eval'`,
    }, /unsafe-eval/i],
    ['disabled HSTS', {
      ...staticSecurityHeaders,
      'strict-transport-security': 'max-age=0',
    }, /strict-transport-security/i],
  ])('rejects %s on the app root', async (_label, headers, expected) => {
    const fetchMock = vi.fn(async (url) => (
      String(url) === `${deploymentOrigin}/`
        ? new Response(`<link rel="canonical" href="${appOrigin}/">`, { headers, status: 200 })
        : successfulResponse(String(url))
    ))

    await expect(runPostDeploySmoke(smokeOptions({ fetchImpl: fetchMock }))).rejects.toThrow(expected)
  })

  it('fails immediately on a Pages 5xx instead of classifying it as propagation', async () => {
    let rootAttempts = 0
    const fetchMock = vi.fn(async (url) => {
      if (String(url) === `${deploymentOrigin}/` && rootAttempts++ === 0) {
        return new Response('temporarily unavailable', { status: 503 })
      }
      return successfulResponse(String(url))
    })

    await expect(runPostDeploySmoke(smokeOptions({ attempts: 2, fetchImpl: fetchMock })))
      .rejects.toThrow(/Deployment root.*503/i)
    expect(rootAttempts).toBe(1)
  })

  it('fails immediately on a network error instead of classifying it as propagation', async () => {
    let rootAttempts = 0
    const fetchMock = vi.fn(async (url) => {
      if (String(url) === `${deploymentOrigin}/`) {
        rootAttempts += 1
        throw new Error('connection reset')
      }
      return successfulResponse(String(url))
    })

    await expect(runPostDeploySmoke(smokeOptions({ attempts: 2, fetchImpl: fetchMock })))
      .rejects.toThrow(/connection reset/i)
    expect(rootAttempts).toBe(1)
  })

  it('fails immediately when security headers do not match', async () => {
    let rootAttempts = 0
    const fetchMock = vi.fn(async (url) => {
      if (String(url) === `${appOrigin}/` && rootAttempts++ === 0) {
        return new Response(`<link rel="canonical" href="${appOrigin}/">`, { status: 200 })
      }
      return successfulResponse(String(url))
    })

    await expect(runPostDeploySmoke(smokeOptions({ attempts: 2, fetchImpl: fetchMock })))
      .rejects.toThrow(/content-security-policy/i)
    expect(rootAttempts).toBe(1)
  })

  it('retries an immutable deployment readiness 404 during Functions propagation', async () => {
    let readinessAttempts = 0
    const fetchMock = vi.fn(async (url) => {
      if (String(url) === `${deploymentOrigin}/api/ready` && readinessAttempts++ === 0) {
        return Response.json({ error: 'not_found' }, { status: 404 })
      }
      return successfulResponse(String(url))
    })

    await runPostDeploySmoke(smokeOptions({ attempts: 2, fetchImpl: fetchMock }))
    expect(readinessAttempts).toBe(2)
  })

  it('enforces a real propagation wall-clock deadline', async () => {
    vi.useFakeTimers()
    try {
      const run = vi.fn(() => new Promise(() => {}))
      const result = withPropagationRetry(run, {
        attempts: 25,
        deadlineMs: 120_000,
        retryDelayMs: 5_000,
      })
      const rejection = expect(result).rejects.toThrow(/120000ms deadline/i)

      await vi.advanceTimersByTimeAsync(120_000)
      await rejection
      expect(run).toHaveBeenCalledOnce()
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not retry non-propagation failures in the retry helper', async () => {
    const failure = new Error('content mismatch')
    const run = vi.fn().mockRejectedValue(failure)

    await expect(withPropagationRetry(run, {
      attempts: 25,
      deadlineMs: 120_000,
      retryDelayMs: 0,
    })).rejects.toBe(failure)
    expect(run).toHaveBeenCalledOnce()
  })

  it('retries an identified release propagation failure', async () => {
    const run = vi.fn()
      .mockRejectedValueOnce(new DeploymentPropagationError('release marker mismatch'))
      .mockResolvedValue('ok')

    await expect(withPropagationRetry(run, {
      attempts: 2,
      deadlineMs: 120_000,
      retryDelayMs: 0,
    })).resolves.toBe('ok')
    expect(run).toHaveBeenCalledTimes(2)
  })

  it('aborts a timed-out request at the single fetch boundary', async () => {
    const fetchMock = vi.fn((_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true })
    }))

    await expect(fetchWithTimeout('https://app.miku-events.dev/slow', {
      fetchImpl: fetchMock,
      timeoutMs: 5,
    })).rejects.toThrow(/Request to .* failed/i)
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('requires both origins and the expected release before making requests', async () => {
    const fetchMock = vi.fn()

    await expect(runPostDeploySmoke(smokeOptions({ appOrigin: '', fetchImpl: fetchMock })))
      .rejects.toThrow('APP_SMOKE_ORIGIN is required')
    await expect(runPostDeploySmoke(smokeOptions({ deploymentOrigin: '', fetchImpl: fetchMock })))
      .rejects.toThrow('DEPLOYMENT_SMOKE_ORIGIN is required')
    await expect(runPostDeploySmoke(smokeOptions({ expectedReleaseId: '', fetchImpl: fetchMock })))
      .rejects.toThrow('EXPECTED_RELEASE_ID is required')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each([
    ['the canonical app origin', appOrigin, /must differ from APP_SMOKE_ORIGIN/i],
    [
      'a branch alias',
      'https://release-preview-01234567.miku-call-guide-app.pages.dev',
      /immutable Cloudflare deployment URL/i,
    ],
    [
      'an arbitrary HTTPS origin',
      'https://deployment.miku-events.dev',
      /immutable Cloudflare deployment URL/i,
    ],
    [
      'an uppercase deployment hash',
      'https://ABCDEF12.miku-call-guide-app.pages.dev',
      /immutable Cloudflare deployment URL/i,
    ],
  ])('rejects %s as DEPLOYMENT_SMOKE_ORIGIN before making requests', async (
    _label,
    candidate,
    expected,
  ) => {
    const fetchMock = vi.fn()

    await expect(runPostDeploySmoke(smokeOptions({
      deploymentOrigin: candidate,
      fetchImpl: fetchMock,
    }))).rejects.toThrow(expected)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects a relative canonical and an incomplete data manifest', async () => {
    const relativeCanonicalFetch = vi.fn(async (url) => (
      String(url) === `${deploymentOrigin}/`
        ? new Response('<link rel="canonical" href="/">', {
          headers: staticSecurityHeaders,
          status: 200,
        })
        : successfulResponse(String(url))
    ))
    await expect(runPostDeploySmoke(smokeOptions({ fetchImpl: relativeCanonicalFetch })))
      .rejects.toThrow(/canonical.*absolute/i)

    const invalidManifestFetch = vi.fn(async (url) => (
      String(url) === manifestUrl
        ? Response.json({ schemaVersion: 1, dataVersion: '' })
        : successfulResponse(String(url))
    ))
    await expect(runPostDeploySmoke(smokeOptions({ fetchImpl: invalidManifestFetch })))
      .rejects.toThrow(/manifest.*dataVersion/i)
  })
})
