import { afterEach, describe, expect, it, vi } from 'vitest'
import { DATA_REQUEST_TIMEOUT_MS, DataRequestTimeoutError } from './dataRequestTimeout'
import { fetchJson, resolveDataUrl } from './manifestShared'

function assertRecord(value: unknown): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Expected a JSON object.')
  }
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('bounded JSON data transport', () => {
  it('reads a valid JSON media type within the decompressed byte limit', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"ready":true}', {
      headers: { 'content-type': 'application/vnd.miku+json; charset=utf-8' },
    })))

    await expect(fetchJson('https://data.example.test/root.json', assertRecord, {
      cache: 'no-cache',
      maxBytes: 32,
    })).resolves.toEqual({ ready: true })
  })

  it('rejects non-JSON media types and redirects', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"ready":true}', {
      headers: { 'content-type': 'text/plain' },
    })))
    await expect(fetchJson('https://data.example.test/root.json', assertRecord, {
      cache: 'no-cache',
      maxBytes: 32,
    })).rejects.toThrow(/non-JSON media type/i)

    const redirected = Response.json({ ready: true })
    Object.defineProperty(redirected, 'redirected', { value: true })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(redirected))
    await expect(fetchJson('https://data.example.test/root.json', assertRecord, {
      cache: 'no-cache',
      maxBytes: 32,
    })).rejects.toThrow(/redirected unexpectedly/i)
  })

  it('rejects declared and chunked responses over the decompressed byte limit', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', {
      headers: {
        'content-length': '1024',
        'content-type': 'application/json',
      },
    })))
    await expect(fetchJson('https://data.example.test/root.json', assertRecord, {
      cache: 'no-cache',
      maxBytes: 8,
    })).rejects.toThrow(/8-byte response limit/i)

    const encoder = new TextEncoder()
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('{"a":'))
        controller.enqueue(encoder.encode('"too-large"}'))
        controller.close()
      },
    })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body, {
      headers: { 'content-type': 'application/json' },
    })))
    await expect(fetchJson('https://data.example.test/root.json', assertRecord, {
      cache: 'no-cache',
      maxBytes: 8,
    })).rejects.toThrow(/8-byte response limit/i)
  })

  it('does not trust a falsely low Content-Length to bypass the streamed byte cap', async () => {
    const encoder = new TextEncoder()
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('{"payload":"'))
        controller.enqueue(encoder.encode('larger-than-declared"}'))
        controller.close()
      },
    })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body, {
      headers: {
        'content-length': '2',
        'content-type': 'application/json',
      },
    })))

    await expect(fetchJson('https://data.example.test/root.json', assertRecord, {
      cache: 'no-cache',
      maxBytes: 16,
    })).rejects.toThrow(/16-byte response limit/i)
  })

  it('rejects invalid UTF-8 before JSON parsing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(
      new Uint8Array([0x7b, 0x22, 0x78, 0x22, 0x3a, 0x22, 0xc3, 0x28, 0x22, 0x7d]),
      { headers: { 'content-type': 'application/json' } },
    )))

    await expect(fetchJson('https://data.example.test/root.json', assertRecord, {
      cache: 'no-cache',
      maxBytes: 32,
    })).rejects.toThrow(/valid UTF-8/i)
  })

  it('aborts an individual request after ten seconds', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
      const signal = init.signal as AbortSignal
      signal.addEventListener('abort', () => reject(signal.reason), { once: true })
    })))

    const request = fetchJson('https://data.example.test/root.json', assertRecord, {
      cache: 'no-cache',
      maxBytes: 32,
      timeoutKind: 'manifest',
    })
    const rejection = expect(request).rejects.toMatchObject({
      kind: 'manifest',
      timeoutMs: DATA_REQUEST_TIMEOUT_MS,
    })
    await vi.advanceTimersByTimeAsync(DATA_REQUEST_TIMEOUT_MS)
    await rejection
    await expect(request).rejects.toBeInstanceOf(DataRequestTimeoutError)
  })

  it('keeps every leaf URL on the manifest origin and rejects credentials', () => {
    expect(resolveDataUrl(
      'https://data.example.test/releases/root.json',
      '../songs/a.json',
    )).toBe('https://data.example.test/songs/a.json')
    expect(() => resolveDataUrl(
      'https://data.example.test/releases/root.json',
      'https://mirror.example.test/songs/a.json',
    )).toThrow(/manifest origin/i)
    expect(() => resolveDataUrl(
      'https://user:secret@data.example.test/root.json',
      'songs/a.json',
    )).toThrow(/without credentials/i)
  })
})
