// @vitest-environment node

import { describe, expect, it, vi } from 'vitest'
import {
  canonicalSubmissionPayload,
  createSubmissionHandler,
  normalizeSubmissionBody,
} from '../../functions/api/events/submissions.js'
import {
  createEditRequestHandler,
  normalizeEditRequestBody,
} from '../../functions/api/events/[eventId]/edit-requests.js'
import { requestIdempotencyKey } from '../../functions/_lib/idempotency.js'
import { normalizeGitHubSession } from '../../functions/_lib/input.js'
import { onRequest as middleware } from '../../functions/_middleware.js'

const validSubmission = {
  attributionConsent: true,
  snsUrl: 'https://x.com/miku/status/1',
  startsOn: '2026-08-10',
  timezone: 'Asia/Seoul',
  title: 'Miku event',
  type: 'concert',
}

function postRequest(
  origin: string,
  body: Record<string, unknown> = validSubmission,
  headers: Record<string, string> = {},
) {
  return new Request(`${origin}/api/events/submissions`, {
    body: JSON.stringify({ ...body, turnstileToken: 'turnstile-token' }),
    headers: { 'content-type': 'application/json', ...headers },
    method: 'POST',
  })
}

describe('submission input hardening', () => {
  const forbiddenSingleLineCodePoints = [
    ...Array.from({ length: 0x20 }, (_, codePoint) => codePoint),
    ...Array.from({ length: 0x21 }, (_, offset) => 0x7f + offset),
    0x061c,
    0x200e,
    0x200f,
    0x2028,
    0x2029,
    ...Array.from({ length: 5 }, (_, offset) => 0x202a + offset),
    ...Array.from({ length: 4 }, (_, offset) => 0x2066 + offset),
  ]
  const forbiddenMultilineCodePoints = forbiddenSingleLineCodePoints.filter(
    (codePoint) => codePoint !== 0x0a && codePoint !== 0x0d,
  )

  it.each(['\nMiku event', 'Miku event\u2028'])(
    'rejects a boundary control before trimming: %j',
    (title) => {
      expect(normalizeSubmissionBody({ ...validSubmission, title }).errors).toContain(
        'title must be a single line without control characters',
      )
    },
  )

  it.each([42, true, {}, [], null])('rejects primitive type confusion (%j)', (title) => {
    const { errors } = normalizeSubmissionBody({ ...validSubmission, title })
    expect(errors).toContain('title must be a string')
  })

  it.each(['sourceUrl', 'note', 'slug', 'endsOn'])(
    'rejects explicit null for optional string field %s',
    (field) => {
      const { errors } = normalizeSubmissionBody({ ...validSubmission, [field]: null })
      expect(errors).toContain(`${field} must be a string`)
    },
  )

  it('continues to accept omitted optional string fields', () => {
    const { errors } = normalizeSubmissionBody(validSubmission)
    expect(errors).toEqual([])
  })

  it('normalizes NFC, trim, and multiline CRLF without changing canonical meaning', () => {
    const { errors, value } = normalizeSubmissionBody({
      ...validSubmission,
      note: '  first\r\nCafe\u0301  ',
      title: '  Cafe\u0301  ',
    })
    expect(errors).toEqual([])
    expect(value.title).toBe('Café')
    expect(value.note).toBe('first\nCafé')
  })

  it('rejects every configured single-line control, separator, and bidi code point', () => {
    for (const codePoint of forbiddenSingleLineCodePoints) {
      const title = `Miku${String.fromCodePoint(codePoint)}event`
      expect(normalizeSubmissionBody({ ...validSubmission, title }).errors).toContain(
        'title must be a single line without control characters',
      )
    }
  })

  it('rejects every configured multiline control and bidi code point except normalized CR/LF', () => {
    for (const codePoint of forbiddenMultilineCodePoints) {
      const note = `line${String.fromCodePoint(codePoint)}text`
      expect(normalizeSubmissionBody({ ...validSubmission, note }).errors).toContain(
        'note contains a forbidden control character',
      )
    }
    expect(normalizeSubmissionBody({ ...validSubmission, note: 'first\r\nsecond\rthird' }))
      .toMatchObject({ errors: [], value: { note: 'first\nsecond\nthird' } })
  })

  it.each(['\tleading', 'trailing\u2028'])(
    'rejects a multiline boundary control before trimming: %j',
    (note) => {
      expect(normalizeSubmissionBody({ ...validSubmission, note }).errors).toContain(
        'note contains a forbidden control character',
      )
    },
  )

  it.each([
    ['HTTP SNS URL', 'http://x.com/miku', 'snsUrl must be an HTTPS URL without credentials'],
    ['credential SNS URL', 'https://user:pass@x.com/miku', 'snsUrl must be an HTTPS URL without credentials'],
    ['lookalike SNS URL', 'https://x.com.evil.example/miku', 'snsUrl must use x.com or twitter.com'],
    ['unrelated SNS URL', 'https://example.com/miku', 'snsUrl must use x.com or twitter.com'],
  ])('rejects %s', (_label, snsUrl, expectedError) => {
    expect(normalizeSubmissionBody({ ...validSubmission, snsUrl }).errors).toContain(expectedError)
  })

  it.each([
    'https://x.com/miku',
    'https://mobile.twitter.com/miku',
  ])('accepts an approved SNS host family: %s', (snsUrl) => {
    expect(normalizeSubmissionBody({ ...validSubmission, snsUrl }).errors).toEqual([])
  })

  it('requires explicit attribution consent for submissions and edits', () => {
    expect(normalizeSubmissionBody({
      ...validSubmission,
      attributionConsent: false,
    }).errors).toContain('attributionConsent must be true')
    expect(normalizeEditRequestBody({ message: 'fix', attributionConsent: false }, 'event-id').errors)
      .toContain('attributionConsent must be true')
  })

  it('normalizes edit prose and rejects controls in edit metadata', () => {
    const valid = normalizeEditRequestBody({
      attributionConsent: true,
      message: ' first\r\nsecond ',
      occurrenceId: ' main ',
      sourceUrl: 'https://example.com/source',
    }, 'event-id')
    expect(valid.errors).toEqual([])
    expect(valid.value).toMatchObject({ message: 'first\nsecond', occurrenceId: 'main' })

    expect(normalizeEditRequestBody({
      attributionConsent: true,
      message: 'safe',
      occurrenceId: 'main\u202e',
    }, 'event-id').errors).toContain(
      'occurrenceId must be a single line without control characters',
    )
    expect(normalizeEditRequestBody({
      attributionConsent: true,
      message: 'safe',
      occurrenceId: '@maintainer',
    }, 'event-id').errors).toContain(
      'occurrenceId must be a valid slug (lowercase letters, numbers, hyphens)',
    )
  })

  it('requires immutable GitHub id and a valid login in sessions', () => {
    expect(normalizeGitHubSession({ id: 39, login: 'miku-user', ts: Date.now() }))
      .toMatchObject({ id: '39', login: 'miku-user' })
    expect(normalizeGitHubSession({ login: 'miku-user', ts: Date.now() })).toBeNull()
    expect(normalizeGitHubSession({ id: 39, login: 'miku\nuser', ts: Date.now() })).toBeNull()
  })
})

describe('write boundary and idempotency', () => {
  it('redirects only the exact production pages.dev hostname with path and query intact', async () => {
    const next = vi.fn(async () => new Response('static'))
    const redirected = await middleware({
      env: { APP_ENV: 'production', APP_ORIGIN: 'https://miku.sekai.today' },
      next,
      request: new Request('https://miku-call-guide-app.pages.dev/events?month=8'),
    })
    expect(redirected.status).toBe(308)
    expect(redirected.headers.get('location')).toBe('https://miku.sekai.today/events?month=8')
    expect(next).not.toHaveBeenCalled()

    const immutable = await middleware({
      env: { APP_ENV: 'production', APP_ORIGIN: 'https://miku.sekai.today' },
      next,
      request: new Request('https://abc123.miku-call-guide-app.pages.dev/events?month=8'),
    })
    expect(immutable.status).toBe(200)
    expect(await immutable.text()).toBe('static')
    expect(next).toHaveBeenCalledOnce()
  })

  it('computes a stable ten-minute fallback and changes it at the next bucket', () => {
    const request = postRequest('https://app.example.test')
    const payload = canonicalSubmissionPayload(normalizeSubmissionBody(validSubmission).value)
    const first = requestIdempotencyKey(request, '39', payload, 599_999)
    const sameBucket = requestIdempotencyKey(request, '39', payload, 1)
    const nextBucket = requestIdempotencyKey(request, '39', payload, 600_000)
    expect(first).toBe(sameBucket)
    expect(nextBucket).not.toBe(first)
  })

  it('rejects a malformed explicit idempotency key', () => {
    const request = postRequest('https://app.example.test', validSubmission, {
      'idempotency-key': 'not-a-uuid',
    })
    expect(() => requestIdempotencyKey(request, '39', '{}')).toThrow('invalid_idempotency_key')
  })

  it('fails preview writes before session, Turnstile, or GitHub access', async () => {
    const readSession = vi.fn()
    const verifyTurnstileToken = vi.fn()
    const createEventPullRequest = vi.fn()
    const handler = createSubmissionHandler({
      createEventPullRequest,
      readSession,
      verifyTurnstileToken,
    })
    const response = await handler({
      env: { APP_ENV: 'preview', SUBMISSION_WRITES_ENABLED: 'false' },
      params: {},
      request: postRequest('https://preview.example.pages.dev'),
    })
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ error: 'submissions_disabled' })
    expect(readSession).not.toHaveBeenCalled()
    expect(verifyTurnstileToken).not.toHaveBeenCalled()
    expect(createEventPullRequest).not.toHaveBeenCalled()
  })

  it.each([
    ['event submission', () => createSubmissionHandler({ readSession: vi.fn() }), {}],
    ['edit request', () => createEditRequestHandler({ readSession: vi.fn() }), { eventId: 'event-id' }],
  ])('returns the kill-switch 403 before parsing a malformed %s body', async (
    _label,
    createHandler,
    params,
  ) => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const response = await createHandler()({
        env: {
          APP_ENV: 'production',
          APP_ORIGIN: 'https://miku.sekai.today',
          SUBMISSION_WRITES_ENABLED: 'false',
        },
        params,
        request: new Request('https://miku.sekai.today/api/events/write', {
          body: '{',
          headers: { 'content-type': 'text/plain' },
          method: 'POST',
        }),
      })
      expect(response.status).toBe(403)
      expect(await response.json()).toMatchObject({ error: 'submissions_disabled' })
    } finally {
      consoleError.mockRestore()
    }
  })

  it('rejects a non-canonical write before parsing an oversized body', async () => {
    const readSession = vi.fn()
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const response = await createSubmissionHandler({ readSession })({
        env: {
          APP_ENV: 'production',
          APP_ORIGIN: 'https://miku.sekai.today',
          SUBMISSION_WRITES_ENABLED: 'true',
        },
        params: {},
        request: new Request('https://immutable.miku-call-guide-app.pages.dev/api/events/submissions', {
          body: '{}',
          headers: {
            'content-length': String((16 * 1024) + 1),
            'content-type': 'application/json',
            origin: 'https://miku.sekai.today',
          },
          method: 'POST',
        }),
      })
      expect(response.status).toBe(403)
      expect(await response.json()).toMatchObject({ error: 'invalid_request_origin' })
      expect(readSession).not.toHaveBeenCalled()
    } finally {
      consoleError.mockRestore()
    }
  })

  it.each([
    ['pages.dev host', 'https://miku-call-guide-app.pages.dev', 'https://miku-call-guide-app.pages.dev'],
    ['missing Origin', 'https://miku.sekai.today', undefined],
    ['foreign Origin', 'https://miku.sekai.today', 'https://evil.example'],
  ])('rejects production %s before session access', async (_label, origin, headerOrigin) => {
    const readSession = vi.fn()
    const handler = createSubmissionHandler({ readSession })
    const response = await handler({
      env: {
        APP_ENV: 'production',
        APP_ORIGIN: 'https://miku.sekai.today',
        SUBMISSION_WRITES_ENABLED: 'true',
      },
      params: {},
      request: postRequest(origin, validSubmission, headerOrigin ? { origin: headerOrigin } : {}),
    })
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ error: 'invalid_request_origin' })
    expect(readSession).not.toHaveBeenCalled()
  })

  it('returns a replay marker while keeping the public response shape stable', async () => {
    const handler = createSubmissionHandler({
      createEventPullRequest: vi.fn(async () => ({
        html_url: 'https://github.example/pull/7',
        replayed: true,
      })),
      readSession: () => ({ id: '39', login: 'miku-user' }),
      verifyTurnstileToken: async () => true,
    })
    const response = await handler({
      env: { APP_ENV: 'test' },
      params: {},
      request: postRequest('https://app.example.test', validSubmission, {
        'idempotency-key': '550e8400-e29b-41d4-a716-446655440000',
      }),
    })
    expect(response.status).toBe(200)
    expect(response.headers.get('idempotency-replayed')).toBe('true')
    expect(await response.json()).toEqual({ url: 'https://github.example/pull/7' })
  })

  it('uses the same actor-and-payload branch and never stores the login in YAML', async () => {
    const createEventPullRequest = vi.fn(async () => ({
      html_url: 'https://github.example/pull/7',
      replayed: false,
    }))
    const handler = createSubmissionHandler({
      createEventPullRequest,
      readSession: () => ({ id: '39', login: 'miku-user' }),
      verifyTurnstileToken: async () => true,
    })
    for (const idempotencyKey of [
      '550e8400-e29b-41d4-a716-446655440000',
      '550e8400-e29b-41d4-a716-446655440001',
    ]) {
      const response = await handler({
        env: { APP_ENV: 'test' },
        params: {},
        request: postRequest('https://app.example.test', {
          ...validSubmission,
          note: 'first\r\nsecond',
        }, { 'idempotency-key': idempotencyKey }),
      })
      expect(response.status).toBe(200)
    }
    const [first, second] = createEventPullRequest.mock.calls.map(([input]) => input)
    expect(first.branchName).toBe(second.branchName)
    expect(first.content).not.toContain('submittedBy')
    expect(first.content).not.toContain('miku-user')
    expect(first.content).toContain('# note: first\n#       second')
  })
})
