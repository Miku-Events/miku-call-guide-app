import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  SubmissionApiError,
  fetchSubmissionSession,
  logoutSubmissionSession,
  submissionErrorPresentation,
  submitEventSubmission,
  type EventSubmissionPayload,
} from './submissionClient'

const payload: EventSubmissionPayload = {
  attributionConsent: true,
  snsUrl: 'https://x.com/example/status/1',
  startsOn: '2026-08-10',
  timezone: 'Asia/Seoul',
  title: '테스트 이벤트',
  turnstileToken: 'turnstile-token',
  type: 'concert',
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('submission client HTTP contract', () => {
  it('accepts an authenticated session only with both immutable ID and login', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(
        JSON.stringify({ authenticated: true, id: 6793499, login: 'miku-user' }),
        { headers: { 'content-type': 'application/json' } },
      ))
      .mockResolvedValueOnce(new Response(
        JSON.stringify({ authenticated: true, login: 'miku-user' }),
        { headers: { 'content-type': 'application/json' } },
      ))
    vi.stubGlobal('fetch', fetchMock)

    await expect(fetchSubmissionSession('https://app.example.test')).resolves.toEqual({
      authenticated: true,
      id: '6793499',
      login: 'miku-user',
    })
    await expect(fetchSubmissionSession('https://app.example.test')).resolves.toEqual({
      authenticated: false,
      id: undefined,
      login: 'miku-user',
    })
  })

  it('sends consent and the caller-owned idempotency key and recognizes a replay', async () => {
    const fetchMock = vi.fn(async () => new Response(
      JSON.stringify({ url: 'https://github.test/pull/42' }),
      {
        headers: {
          'content-type': 'application/json',
          'idempotency-replayed': 'true',
        },
      },
    ))
    vi.stubGlobal('fetch', fetchMock)

    await expect(submitEventSubmission(
      'https://app.example.test',
      payload,
      '123e4567-e89b-42d3-a456-426614174000',
    )).resolves.toEqual({ replayed: true, url: 'https://github.test/pull/42' })

    const [, init] = fetchMock.mock.calls[0]
    expect(new Headers(init?.headers).get('idempotency-key')).toBe(
      '123e4567-e89b-42d3-a456-426614174000',
    )
    expect(JSON.parse(String(init?.body))).toMatchObject({ attributionConsent: true })
  })

  it('preserves a structured conflict request ID for support', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ error: 'submission_conflict', requestId: 'req-conflict-1' }),
      { headers: { 'content-type': 'application/json' }, status: 409 },
    )))

    const request = submitEventSubmission(
      'https://app.example.test',
      payload,
      '123e4567-e89b-42d3-a456-426614174000',
    )
    await expect(request).rejects.toMatchObject({
      code: 'submission_conflict',
      requestId: 'req-conflict-1',
      status: 409,
    })

    try {
      await request
    } catch (error: unknown) {
      expect(submissionErrorPresentation(error, 'fallback')).toEqual({
        message: '이미 같은 일정이 등록되어 있거나 처리 중입니다.',
        requestId: 'req-conflict-1',
        retryGuidance: '기존 일정과 제출 내역을 확인한 뒤, 내용이 다를 때만 다시 시도해 주세요.',
      })
    }
  })

  it('distinguishes a request-ID-less WAF rate limit response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ error: 'rate_limited' }),
      {
        headers: { 'content-type': 'application/json', 'retry-after': '10' },
        status: 429,
      },
    )))

    try {
      await submitEventSubmission(
        'https://app.example.test',
        payload,
        '123e4567-e89b-42d3-a456-426614174000',
      )
      throw new Error('expected request to fail')
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(SubmissionApiError)
      expect(submissionErrorPresentation(error, 'fallback')).toEqual({
        message: 'Cloudflare 보호 계층에서 요청을 일시적으로 제한했습니다.',
        requestId: undefined,
        retryGuidance: '10초 후 다시 시도해 주세요.',
      })
    }
  })

  it('logs out with a credentialed POST', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)

    await logoutSubmissionSession('https://app.example.test')

    expect(fetchMock).toHaveBeenCalledWith(
      'https://app.example.test/api/auth/logout',
      { credentials: 'include', method: 'POST' },
    )
  })
})
