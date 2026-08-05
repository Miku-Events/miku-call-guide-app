// @vitest-environment node

import { describe, expect, it, vi } from 'vitest'
import { onRequest } from '../../functions/_middleware.js'

describe('Pages legacy-origin middleware', () => {
  it.each([
    ['root', 'https://miku.sekai.today/', 'https://miku-call-guide-app.pages.dev/'],
    ['hash route document', 'https://miku.sekai.today/?source=legacy', 'https://miku-call-guide-app.pages.dev/?source=legacy'],
    ['hashed asset', 'https://miku.sekai.today/assets/catalog.js', 'https://miku-call-guide-app.pages.dev/assets/catalog.js'],
    ['API request', 'https://miku.sekai.today/api/ready', 'https://miku-call-guide-app.pages.dev/api/ready'],
  ])('redirects the legacy %s request without invoking the route', async (_label, source, target) => {
    const next = vi.fn()
    const response = await onRequest({ next, request: new Request(source) })

    expect(response.status).toBe(308)
    expect(response.headers.get('location')).toBe(target)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('strict-transport-security')).toBe('max-age=31536000')
    expect(next).not.toHaveBeenCalled()
  })

  it.each([
    'https://miku-call-guide-app.pages.dev/',
    'https://preview.miku-call-guide-app.pages.dev/',
  ])('passes through the supported hostname %s', async (url) => {
    const expected = new Response('next')
    const next = vi.fn(async () => expected)

    await expect(onRequest({ next, request: new Request(url) })).resolves.toBe(expected)
    expect(next).toHaveBeenCalledOnce()
  })
})
