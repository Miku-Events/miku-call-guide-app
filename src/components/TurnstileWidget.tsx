import { useEffect, useRef } from 'react'

export type TurnstileAction = 'event_submit' | 'event_edit'

declare global {
  interface Window {
    onloadTurnstileCallback?: () => void
    turnstile?: {
      render: (
        container: string | HTMLElement,
        options: {
          sitekey: string
          action: TurnstileAction
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
  action: TurnstileAction
  onVerify: (token: string | null) => void
  theme?: 'light' | 'dark' | 'auto'
}

const DEFAULT_DEV_SITE_KEY = '1x00000000000000000000AA'

function resolveTurnstileSiteKey(siteKey: string | undefined, isDevelopment: boolean) {
  const configuredSiteKey = siteKey?.trim()
  if (configuredSiteKey) return configuredSiteKey
  return isDevelopment ? DEFAULT_DEV_SITE_KEY : null
}

export function TurnstileWidget({ action, onVerify, theme = 'dark' }: TurnstileWidgetProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const widgetIdRef = useRef<string | null>(null)
  const siteKey = resolveTurnstileSiteKey(
    import.meta.env.VITE_CLOUDFLARE_TURNSTILE_SITE_KEY,
    import.meta.env.DEV,
  )

  useEffect(() => {
    if (!siteKey) return

    let isMounted = true

    const initializeWidget = () => {
      if (!isMounted || !containerRef.current || !window.turnstile) return
      
      try {
        if (widgetIdRef.current) {
          window.turnstile.remove(widgetIdRef.current)
        }

        widgetIdRef.current = window.turnstile.render(containerRef.current, {
          sitekey: siteKey,
          action,
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
  }, [action, onVerify, siteKey, theme])

  if (!siteKey) {
    return (
      <div
        role="alert"
        className="turnstile-container-wrapper"
        style={{ minHeight: '65px' }}
      >
        보안 검증 설정 오류: Turnstile 사이트 키가 설정되지 않았습니다.
      </div>
    )
  }

  return <div ref={containerRef} className="turnstile-container-wrapper" style={{ minHeight: '65px' }} />
}
