// @vitest-environment node

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cloudflareAdapter } from '../../functions/api/_adapter.js'
import type { ApiEnvironment, TestRequest, TestResponse } from './apiTestHarness'

interface AdapterContext {
  request: Request
  env: ApiEnvironment
  params: Record<string, string>
}

type StreamingRequestInit = RequestInit & { duplex: 'half' }

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function context(
  request: Request,
  env: ApiEnvironment = {},
  params: Record<string, string> = {},
): AdapterContext {
  return { env, params, request }
}

function expectSecurityHeaders(response: Response): void {
  expect(response.headers.get('cache-control')).toBe('no-store')
  expect(response.headers.get('content-security-policy')).toContain("default-src 'none'")
  expect(response.headers.get('permissions-policy')).toBe(
    'camera=(), microphone=(), geolocation=()',
  )
  expect(response.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin')
  expect(response.headers.get('strict-transport-security')).toBe('max-age=31536000')
  expect(response.headers.get('x-content-type-options')).toBe('nosniff')
  expect(response.headers.get('x-request-id')).toMatch(UUID_PATTERN)
}

function exactSizeJson(byteLength: number): string {
  const framingBytes = Buffer.byteLength(JSON.stringify({ value: '' }), 'utf8')
  const payloadBytes = byteLength - framingBytes
  const multibyteCharacters = Math.floor(payloadBytes / 3)
  const asciiCharacters = payloadBytes - (multibyteCharacters * 3)
  const result = JSON.stringify({
    value: `${'가'.repeat(multibyteCharacters)}${'a'.repeat(asciiCharacters)}`,
  })
  expect(Buffer.byteLength(result, 'utf8')).toBe(byteLength)
  return result
}

function streamingRequest(
  url: string,
  chunks: Uint8Array[],
  hooks: { cancel?: ReturnType<typeof vi.fn>; pull?: ReturnType<typeof vi.fn> } = {},
): Request {
  let index = 0
  const stream = new ReadableStream<Uint8Array>({
    cancel: hooks.cancel,
    pull(controller) {
      hooks.pull?.()
      const chunk = chunks[index]
      index += 1
      if (chunk) {
        controller.enqueue(chunk)
      } else {
        controller.close()
      }
    },
  })
  return new Request(url, {
    body: stream,
    duplex: 'half',
    headers: { 'content-type': 'application/json; charset=utf-8' },
    method: 'POST',
  } as StreamingRequestInit)
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('cloudflareAdapter response semantics', () => {
  it('keeps multiple Set-Cookie values distinct and a 204 body empty', async () => {
    const handler = (_request: TestRequest, response: TestResponse): void => {
      response.appendHeader('set-cookie', 'first=one; Path=/; HttpOnly')
      response.appendHeader('set-cookie', 'second=two; Path=/; HttpOnly')
      response.status(204).end()
    }
    const onRequest = cloudflareAdapter(handler)
    const response = await onRequest(context(new Request(
      'https://app.example.test/api/auth/logout',
      { method: 'POST' },
    )))

    expect(response.status).toBe(204)
    expect(await response.text()).toBe('')
    expect(response.headers.getSetCookie()).toEqual([
      'first=one; Path=/; HttpOnly',
      'second=two; Path=/; HttpOnly',
    ])
    expectSecurityHeaders(response)
  })

  it('preserves redirects and applies direct security headers', async () => {
    const onRequest = cloudflareAdapter((
      _request: TestRequest,
      response: TestResponse,
    ): void => {
      response.redirect('https://github.com/login/oauth/authorize')
    })

    const response = await onRequest(context(new Request(
      'https://app.example.test/api/auth/github/start',
    )))

    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe('https://github.com/login/oauth/authorize')
    expect(await response.text()).toBe('')
    expectSecurityHeaders(response)
  })

  it('applies security headers and a server request ID to JSON responses', async () => {
    const onRequest = cloudflareAdapter((
      _request: TestRequest,
      response: TestResponse,
    ): void => {
      response.status(200).json({ ok: true })
    })
    const response = await onRequest(context(new Request(
      'https://app.example.test/api/auth/session',
      { headers: { 'x-request-id': 'attacker-controlled' } },
    )))

    expect(await response.json()).toEqual({ ok: true })
    expect(response.headers.get('x-request-id')).not.toBe('attacker-controlled')
    expectSecurityHeaders(response)
  })

  it('keeps CSP enforced for preview Function responses', async () => {
    const onRequest = cloudflareAdapter((
      _request: TestRequest,
      response: TestResponse,
    ): void => {
      response.status(200).json({ ok: true })
    })
    const response = await onRequest(context(
      new Request('https://preview.example.test/api/auth/session'),
      { APP_ENV: 'preview' },
    ))

    expect(await response.json()).toEqual({ ok: true })
    expectSecurityHeaders(response)
    expect(response.headers.get('content-security-policy-report-only')).toBeNull()
  })
})

describe('cloudflareAdapter strict write bodies', () => {
  it('accepts exactly 16 KiB on an event write route', async () => {
    const body = exactSizeJson(16 * 1024)
    const handler = vi.fn((request: TestRequest, response: TestResponse): void => {
      response.status(200).json({ byteLength: Buffer.byteLength(String(request.body), 'utf8') })
    })
    const response = await cloudflareAdapter(handler)(context(streamingRequest(
      'https://app.example.test/api/events/submissions',
      [new TextEncoder().encode(body)],
    )))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ byteLength: 16 * 1024 })
    expect(handler).toHaveBeenCalledOnce()
  })

  it('cancels at byte 16385 and returns a standardized 413 without invoking the handler', async () => {
    const cancel = vi.fn()
    const body = exactSizeJson((16 * 1024) + 1)
    const bytes = new TextEncoder().encode(body)
    const handler = vi.fn()
    const response = await cloudflareAdapter(handler)(context(streamingRequest(
      'https://app.example.test/api/events/test-event/edit-requests',
      [bytes.slice(0, 16 * 1024), bytes.slice(16 * 1024)],
      { cancel },
    )))

    expect(response.status).toBe(413)
    const result = await response.json() as { error: string; requestId: string }
    expect(result).toEqual({
      error: 'request_body_too_large',
      requestId: expect.stringMatching(UUID_PATTERN),
    })
    expect(response.headers.get('x-request-id')).toBe(result.requestId)
    expect(cancel).toHaveBeenCalledOnce()
    expect(handler).not.toHaveBeenCalled()
    expectSecurityHeaders(response)
  })

  it('keeps the intended 413 when stream cancellation rejects', async () => {
    const cancel = vi.fn().mockRejectedValue(new Error('raw cancel failure'))
    const body = exactSizeJson((16 * 1024) + 1)
    const handler = vi.fn()
    const response = await cloudflareAdapter(handler)(context(streamingRequest(
      'https://app.example.test/api/events/submissions',
      [new TextEncoder().encode(body)],
      { cancel },
    )))

    expect(response.status).toBe(413)
    expect(await response.json()).toEqual({
      error: 'request_body_too_large',
      requestId: expect.stringMatching(UUID_PATTERN),
    })
    expect(cancel).toHaveBeenCalledOnce()
    expect(handler).not.toHaveBeenCalled()
  })

  it('keeps the intended 413 when cancelling a declared oversized body rejects', async () => {
    const cancel = vi.fn().mockRejectedValue(new Error('raw declared-length cancel failure'))
    const request = streamingRequest(
      'https://app.example.test/api/events/submissions',
      [new TextEncoder().encode('{}')],
      { cancel },
    )
    request.headers.set('content-length', String((16 * 1024) + 1))
    const handler = vi.fn()

    const response = await cloudflareAdapter(handler)(context(request))

    expect(response.status).toBe(413)
    expect(await response.json()).toEqual({
      error: 'request_body_too_large',
      requestId: expect.stringMatching(UUID_PATTERN),
    })
    expect(cancel).toHaveBeenCalledOnce()
    expect(handler).not.toHaveBeenCalled()
  })

  it('returns standardized early content-type errors', async () => {
    const handler = vi.fn()
    const response = await cloudflareAdapter(handler)(context(new Request(
      'https://app.example.test/api/events/submissions',
      {
        body: '{}',
        headers: { 'content-type': 'text/plain' },
        method: 'POST',
      },
    )))

    expect(response.status).toBe(415)
    expect(await response.json()).toEqual({
      error: 'unsupported_media_type',
      requestId: expect.stringMatching(UUID_PATTERN),
    })
    expect(handler).not.toHaveBeenCalled()
    expectSecurityHeaders(response)
  })

  it('does not consume a non-write route body', async () => {
    const request = new Request('https://app.example.test/api/auth/logout', {
      body: '{}',
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    })
    const getReader = vi.spyOn(request.body as ReadableStream<Uint8Array>, 'getReader')
    const onRequest = cloudflareAdapter((
      received: TestRequest,
      response: TestResponse,
    ): void => {
      expect(received.body).toBeUndefined()
      response.status(204).end()
    })

    const response = await onRequest(context(request))

    expect(response.status).toBe(204)
    expect(getReader).not.toHaveBeenCalled()
  })
})

describe('cloudflareAdapter request environment isolation', () => {
  it('keeps concurrent request env exact and leaves process.env unchanged', async () => {
    const originalEnvironment = { ...process.env }
    const arrivals: Array<() => void> = []
    let arrived = 0
    const barrier = new Promise<void>((resolve) => {
      arrivals.push(resolve)
    })
    const handler = async (request: TestRequest, response: TestResponse): Promise<void> => {
      arrived += 1
      if (arrived === 2) {
        arrivals[0]?.()
      }
      await barrier
      response.status(200).json({
        environment: request.env?.REQUEST_ENV_MARKER,
        processMarker: process.env.REQUEST_ENV_MARKER ?? null,
      })
    }
    const onRequest = cloudflareAdapter(handler)

    const [first, second] = await Promise.all([
      onRequest(context(
        new Request('https://app.example.test/api/auth/session'),
        { REQUEST_ENV_MARKER: 'first-request' },
      )),
      onRequest(context(
        new Request('https://app.example.test/api/auth/session'),
        { REQUEST_ENV_MARKER: 'second-request' },
      )),
    ])

    expect(await first.json()).toEqual({
      environment: 'first-request',
      processMarker: originalEnvironment.REQUEST_ENV_MARKER ?? null,
    })
    expect(await second.json()).toEqual({
      environment: 'second-request',
      processMarker: originalEnvironment.REQUEST_ENV_MARKER ?? null,
    })
    expect(process.env).toEqual(originalEnvironment)
  })
})
