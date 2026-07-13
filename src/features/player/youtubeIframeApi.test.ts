import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { loadYouTubeIframeApi, YOUTUBE_IFRAME_API_SRC } from './youtubeIframeApi'

function installPlayerApi() {
  window.YT = { Player: vi.fn() as unknown as NonNullable<typeof window.YT>['Player'] }
}

beforeEach(() => {
  vi.useFakeTimers()
  delete window.YT
  delete window.onYouTubeIframeAPIReady
  document.querySelectorAll(`script[src="${YOUTUBE_IFRAME_API_SRC}"]`).forEach((script) => script.remove())
})

afterEach(() => {
  vi.useRealTimers()
  delete window.YT
  delete window.onYouTubeIframeAPIReady
  document.querySelectorAll(`script[src="${YOUTUBE_IFRAME_API_SRC}"]`).forEach((script) => script.remove())
})

describe('loadYouTubeIframeApi', () => {
  it('creates one script and settles after polling finds the player API', async () => {
    const pending = loadYouTubeIframeApi()
    expect(document.querySelectorAll(`script[src="${YOUTUBE_IFRAME_API_SRC}"]`)).toHaveLength(1)

    installPlayerApi()
    await vi.advanceTimersByTimeAsync(50)

    await expect(pending).resolves.toBeUndefined()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('reuses an existing script instead of appending a duplicate', async () => {
    const existing = document.createElement('script')
    existing.src = YOUTUBE_IFRAME_API_SRC
    document.head.appendChild(existing)

    const pending = loadYouTubeIframeApi()
    expect(document.querySelectorAll(`script[src="${YOUTUBE_IFRAME_API_SRC}"]`)).toHaveLength(1)

    installPlayerApi()
    await vi.advanceTimersByTimeAsync(50)
    await expect(pending).resolves.toBeUndefined()
  })

  it('removes a failed script so a retry can create a fresh element', async () => {
    const firstLoad = loadYouTubeIframeApi()
    const failedScript = document.querySelector<HTMLScriptElement>(`script[src="${YOUTUBE_IFRAME_API_SRC}"]`)
    failedScript?.dispatchEvent(new Event('error'))

    await expect(firstLoad).rejects.toThrow('YouTube IFrame API script failed to load.')
    expect(failedScript?.isConnected).toBe(false)

    const retry = loadYouTubeIframeApi()
    const retryScript = document.querySelector<HTMLScriptElement>(`script[src="${YOUTUBE_IFRAME_API_SRC}"]`)
    expect(retryScript).not.toBe(failedScript)
    installPlayerApi()
    await vi.advanceTimersByTimeAsync(50)
    await expect(retry).resolves.toBeUndefined()
  })

  it('times out after ten seconds and removes the unusable script', async () => {
    const pending = loadYouTubeIframeApi()
    const script = document.querySelector<HTMLScriptElement>(`script[src="${YOUTUBE_IFRAME_API_SRC}"]`)
    const rejection = expect(pending).rejects.toThrow('YouTube IFrame API load timed out.')

    await vi.advanceTimersByTimeAsync(10_000)

    await rejection
    expect(script?.isConnected).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('rejects aborts and cleans all polling and timeout work', async () => {
    const controller = new AbortController()
    const pending = loadYouTubeIframeApi(controller.signal)

    controller.abort()

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(vi.getTimerCount()).toBe(0)
    expect(document.querySelector(`script[src="${YOUTUBE_IFRAME_API_SRC}"]`)).toBeNull()
  })
})
