import { JSDOM } from 'jsdom'
import { describe, expect, it } from 'vitest'
import { initializeCloudflareWebAnalytics } from './cloudflareWebAnalytics'

const validToken = 'a'.repeat(32)
const beaconConfiguration = JSON.stringify({ token: validToken })
const beaconSelector = 'script[src="https://static.cloudflareinsights.com/beacon.min.js"]'

function createDocument(origin: string): Document {
  return new JSDOM('<!doctype html><html><head></head><body></body></html>', { url: origin }).window.document
}

describe('Cloudflare Web Analytics bootstrap baseline', () => {
  it('Given the current application document, when no analytics bootstrap has run, then it has no Cloudflare beacon script', () => {
    expect(document.querySelectorAll(beaconSelector)).toHaveLength(0)
  })
})

describe('initializeCloudflareWebAnalytics', () => {
  it('Given the canonical production origin and a valid release token, when the loader runs twice, then it appends exactly one safe Cloudflare module script', () => {
    const documentValue = createDocument('https://miku.sekai.today')

    initializeCloudflareWebAnalytics({
      document: documentValue,
      origin: 'https://miku.sekai.today',
      productionRelease: true,
      token: validToken,
    })
    initializeCloudflareWebAnalytics({
      document: documentValue,
      origin: 'https://miku.sekai.today',
      productionRelease: true,
      token: validToken,
    })

    const scripts = documentValue.querySelectorAll<HTMLScriptElement>(beaconSelector)
    expect(scripts).toHaveLength(1)
    const script = scripts.item(0)
    expect(script?.getAttribute('type')).toBe('module')
    expect(script?.getAttribute('src')).toBe('https://static.cloudflareinsights.com/beacon.min.js')
    expect(script?.getAttribute('data-cf-beacon')).toBe(beaconConfiguration)
  })

  it.each([
    'https://miku.sekai.today:444',
    'https://not-miku.sekai.today',
    'http://127.0.0.1:4173',
  ])('Given a non-canonical origin, when the loader runs, then it appends no beacon script (%s)', (origin) => {
    const documentValue = createDocument(origin)

    initializeCloudflareWebAnalytics({
      document: documentValue,
      origin,
      productionRelease: true,
      token: validToken,
    })

    expect(documentValue.querySelectorAll(beaconSelector)).toHaveLength(0)
  })

  it.each([
    undefined,
    'A'.repeat(32),
    'a'.repeat(31),
    `a${' '.repeat(31)}`,
  ])('Given a missing or malformed token, when the loader runs, then it appends no beacon script', (token) => {
    const documentValue = createDocument('https://miku.sekai.today')

    initializeCloudflareWebAnalytics({
      document: documentValue,
      origin: 'https://miku.sekai.today',
      productionRelease: true,
      token,
    })

    expect(documentValue.querySelectorAll(beaconSelector)).toHaveLength(0)
  })

  it('Given a valid token outside a production release, when the loader runs, then it appends no beacon script', () => {
    const documentValue = createDocument('https://miku.sekai.today')

    initializeCloudflareWebAnalytics({
      document: documentValue,
      origin: 'https://miku.sekai.today',
      productionRelease: false,
      token: validToken,
    })

    expect(documentValue.querySelectorAll(beaconSelector)).toHaveLength(0)
  })

  it('Given a blocked beacon script, when its error event fires after initialization, then application startup remains nonfatal', () => {
    const documentValue = createDocument('https://miku.sekai.today')

    expect(() => {
      initializeCloudflareWebAnalytics({
        document: documentValue,
        origin: 'https://miku.sekai.today',
        productionRelease: true,
        token: validToken,
      })
      documentValue.querySelector<HTMLScriptElement>(beaconSelector)?.dispatchEvent(new Event('error'))
    }).not.toThrow()
  })
})
