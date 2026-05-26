import { useEffect, useRef } from 'react'

declare global {
  interface Window {
    onloadTurnstileCallback?: () => void
    turnstile?: {
      render: (
        container: string | HTMLElement,
        options: {
          sitekey: string
          callback: (token: string) => void
          'expired-callback'?: () => void
          'error-callback'?: () => void
          theme?: 'light' | 'dark' | 'auto'
        }
      ) => string
      reset: (widgetId: string) => void
      remove: (widgetId: string) => void
    }
  }
}

interface TurnstileWidgetProps {
  onVerify: (token: string | null) => void
  theme?: 'light' | 'dark' | 'auto'
}

const DEFAULT_SITE_KEY = '1x00000000000000000000AA' // Cloudflare 공식 무조건 성공 테스트 키

export function TurnstileWidget({ onVerify, theme = 'dark' }: TurnstileWidgetProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const widgetIdRef = useRef<string | null>(null)

  useEffect(() => {
    const siteKey = import.meta.env.VITE_CLOUDFLARE_TURNSTILE_SITE_KEY || DEFAULT_SITE_KEY
    let isMounted = true

    const initializeWidget = () => {
      if (!isMounted || !containerRef.current || !window.turnstile) return
      
      try {
        if (widgetIdRef.current) {
          window.turnstile.remove(widgetIdRef.current)
        }

        widgetIdRef.current = window.turnstile.render(containerRef.current, {
          sitekey: siteKey,
          theme,
          callback: (token) => {
            if (isMounted) onVerify(token)
          },
          'expired-callback': () => {
            if (isMounted) onVerify(null)
          },
          'error-callback': () => {
            if (isMounted) onVerify(null)
          },
        })
      } catch (err) {
        console.error('Turnstile rendering failed:', err)
      }
    }

    if (window.turnstile) {
      initializeWidget()
    } else {
      window.onloadTurnstileCallback = () => {
        initializeWidget()
      }

      if (!document.querySelector('script[src*="challenges.cloudflare.com"]')) {
        const script = document.createElement('script')
        script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=onloadTurnstileCallback'
        script.async = true
        script.defer = true
        document.head.appendChild(script)
      }
    }

    return () => {
      isMounted = false
      if (widgetIdRef.current && window.turnstile) {
        window.turnstile.remove(widgetIdRef.current)
      }
    }
  }, [onVerify, theme])

  return <div ref={containerRef} className="turnstile-container-wrapper" style={{ minHeight: '65px' }} />
}
