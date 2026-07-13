import { useEffect, useRef, useState } from 'react'
import { localizedText } from '../../shared/i18n/localizedText'
import type { EventLink } from '../data/types'

declare global {
  interface Window {
    twttr?: {
      widgets?: {
        load: (element?: HTMLElement) => void | Promise<unknown>
      }
    }
  }
}

let widgetsScriptPromise: Promise<void> | null = null

function loadXWidgets(): Promise<void> {
  if (window.twttr?.widgets) {
    return Promise.resolve()
  }

  if (widgetsScriptPromise) {
    return widgetsScriptPromise
  }

  widgetsScriptPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-x-widgets="true"]')
    if (existing) {
      existing.addEventListener('load', () => resolve(), { once: true })
      existing.addEventListener('error', () => reject(new Error('X widgets script failed to load.')), { once: true })
      return
    }

    const script = document.createElement('script')
    script.async = true
    script.charset = 'utf-8'
    script.dataset.xWidgets = 'true'
    script.src = 'https://platform.x.com/widgets.js'
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('X widgets script failed to load.'))
    document.head.append(script)
  })

  return widgetsScriptPromise
}

interface XPostEmbedProps {
  link: EventLink
}

export function XPostEmbed({ link }: XPostEmbedProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [failedUrl, setFailedUrl] = useState<string | null>(null)
  const failed = failedUrl === link.url
  const label = localizedText(link.label, 'ko', ['ja', 'en']) || 'X announcement'

  useEffect(() => {
    let cancelled = false

    void loadXWidgets()
      .then(() => {
        if (!cancelled && containerRef.current) {
          void window.twttr?.widgets?.load(containerRef.current)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setFailedUrl(link.url)
        }
      })

    return () => {
      cancelled = true
    }
  }, [link.url])

  return (
    <div className="event-x-embed" data-load-state={failed ? 'fallback' : 'ready'} ref={containerRef}>
      <blockquote className="twitter-tweet" data-conversation="none" data-dnt="true" data-theme="dark">
        <a href={link.url}>{label}</a>
      </blockquote>
      {failed ? <p className="event-x-embed-fallback">임베드를 불러오지 못했습니다. 링크로 공지를 확인하세요.</p> : null}
    </div>
  )
}
