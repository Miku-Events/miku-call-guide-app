// @vitest-environment node

import { readFile } from 'node:fs/promises'
import { describe, expect, it, vi } from 'vitest'
import { onRequest } from '../../functions/_middleware.js'

describe('Pages static delivery middleware', () => {
  it.each([
    'https://miku.sekai.today/',
    'https://miku-call-guide-app.pages.dev/',
    'https://future-custom-domain.example.dev/?source=custom',
  ])('serves HTML on the requested origin %s without redirecting', async (url) => {
    const next = vi.fn(async () => new Response('<!doctype html><title>Miku</title>', {
      headers: {
        'cache-control': 'public, max-age=14400',
        'content-type': 'text/html; charset=utf-8',
        'x-existing-header': 'preserved',
      },
    }))
    const response = await onRequest({ next, request: new Request(url) })

    expect(response.status).toBe(200)
    expect(response.headers.get('location')).toBeNull()
    expect(response.headers.get('cache-control')).toBe('no-cache, no-transform')
    expect(response.headers.get('x-existing-header')).toBe('preserved')
    await expect(response.text()).resolves.toContain('<title>Miku</title>')
    expect(next).toHaveBeenCalledOnce()
  })

  it('passes non-HTML responses through unchanged', async () => {
    const expected = Response.json({ ready: true }, {
      headers: { 'cache-control': 'no-store' },
    })
    const next = vi.fn(async () => expected)

    await expect(onRequest({
      next,
      request: new Request('https://miku.sekai.today/api/ready'),
    })).resolves.toBe(expected)
    expect(next).toHaveBeenCalledOnce()
  })

  it('preserves an HTML 404 status while disabling cached transforms', async () => {
    const response = await onRequest({
      next: async () => new Response('missing', {
        headers: { 'content-type': 'text/html' },
        status: 404,
        statusText: 'Not Found',
      }),
      request: new Request('https://miku.sekai.today/assets/missing.js'),
    })

    expect(response.status).toBe(404)
    expect(response.statusText).toBe('Not Found')
    expect(response.headers.get('cache-control')).toBe('no-cache, no-transform')
  })

  it('ships a script-free top-level 404 document so missing assets do not receive the SPA shell', async () => {
    const html = await readFile(new URL('../../public/404.html', import.meta.url), 'utf8')

    expect(html).toMatch(/<!doctype html>/i)
    expect(html).toMatch(/<title>[^<]*404[^<]*<\/title>/i)
    expect(html).not.toMatch(/<script\b/i)
  })
})
