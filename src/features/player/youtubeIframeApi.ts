export const YOUTUBE_IFRAME_API_SRC = 'https://www.youtube.com/iframe_api'

export const YOUTUBE_PLAYER_STATE = {
  UNSTARTED: -1,
  ENDED: 0,
  PLAYING: 1,
  PAUSED: 2,
  BUFFERING: 3,
  CUED: 5,
} as const

export type YouTubePlayerState = typeof YOUTUBE_PLAYER_STATE[keyof typeof YOUTUBE_PLAYER_STATE]

export type YouTubePlayerInstance = {
  getCurrentTime: () => number
  getPlayerState: () => YouTubePlayerState | number
  seekTo: (seconds: number, allowSeekAhead?: boolean) => void
  destroy: () => void
}

export interface YouTubePlayerEvent<T = YouTubePlayerInstance> {
  target: T
}

export interface YouTubePlayerStateChangeEvent extends YouTubePlayerEvent {
  data: YouTubePlayerState | number
}

export type YouTubeConstructor = new (
  element: HTMLElement,
  options: {
    videoId: string
    playerVars: Record<string, string | number>
    events: {
      onError?: (event: YouTubePlayerEvent) => void
      onReady?: (event: YouTubePlayerEvent) => void
      onStateChange?: (event: YouTubePlayerStateChangeEvent) => void
    }
  },
) => YouTubePlayerInstance

declare global {
  interface Window {
    YT?: {
      Player: YouTubeConstructor
    }
    onYouTubeIframeAPIReady?: () => void
  }
}

function abortError(): DOMException {
  return new DOMException('YouTube IFrame API load was aborted.', 'AbortError')
}

export function loadYouTubeIframeApi(signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    return Promise.reject(abortError())
  }
  if (window.YT?.Player) {
    return Promise.resolve()
  }

  let script = document.querySelector<HTMLScriptElement>(`script[src="${YOUTUBE_IFRAME_API_SRC}"]`)
  const shouldAppend = !script
  if (!script) {
    script = document.createElement('script')
    script.async = true
    script.src = YOUTUBE_IFRAME_API_SRC
  }

  return new Promise((resolve, reject) => {
    let settled = false
    let pollId = 0
    let timeoutId = 0

    const cleanup = () => {
      window.clearInterval(pollId)
      window.clearTimeout(timeoutId)
      script.removeEventListener('load', checkReady)
      script.removeEventListener('error', handleScriptError)
      signal?.removeEventListener('abort', handleAbort)
    }
    const succeed = () => {
      if (settled) return
      settled = true
      cleanup()
      resolve()
    }
    const fail = (error: Error | DOMException) => {
      if (settled) return
      settled = true
      cleanup()
      script.remove()
      reject(error)
    }
    const checkReady = () => {
      if (window.YT?.Player) {
        succeed()
      }
    }
    const handleScriptError = () => {
      fail(new Error('YouTube IFrame API script failed to load.'))
    }
    const handleAbort = () => {
      fail(abortError())
    }

    script.addEventListener('load', checkReady)
    script.addEventListener('error', handleScriptError)
    signal?.addEventListener('abort', handleAbort, { once: true })
    pollId = window.setInterval(checkReady, 50)
    timeoutId = window.setTimeout(() => {
      fail(new Error('YouTube IFrame API load timed out.'))
    }, 10_000)

    if (shouldAppend) {
      document.head.appendChild(script)
    }
    checkReady()
  })
}
