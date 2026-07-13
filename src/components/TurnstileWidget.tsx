import { useEffect, useRef, useState } from 'react'

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
  resetNonce?: number
  theme?: 'light' | 'dark' | 'auto'
}

const DEFAULT_DEV_SITE_KEY = '1x00000000000000000000AA'

function resolveTurnstileSiteKey(siteKey: string | undefined, isDevelopment: boolean) {
  const configuredSiteKey = siteKey?.trim()
  if (configuredSiteKey) return configuredSiteKey
  return isDevelopment ? DEFAULT_DEV_SITE_KEY : null
}

export function TurnstileWidget({
  action,
  onVerify,
  resetNonce = 0,
  theme = 'dark',
}: TurnstileWidgetProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const widgetIdRef = useRef<string | null>(null)
  const previousResetNonceRef = useRef(resetNonce)
  const [status, setStatus] = useState('보안 검증이 필요합니다.')
  const [hasError, setHasError] = useState(false)
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
            if (isMounted) {
              setHasError(false)
              setStatus('보안 검증이 완료되었습니다.')
              onVerify(token)
            }
          },
          'expired-callback': () => {
            if (isMounted) {
              setStatus('보안 검증이 만료되었습니다. 다시 완료해 주세요.')
              onVerify(null)
            }
          },
          'error-callback': () => {
            if (isMounted) {
              setHasError(true)
              setStatus('보안 검증에 실패했습니다. 다시 시도해 주세요.')
              onVerify(null)
            }
          },
        })
      } catch (err) {
        console.error('Turnstile rendering failed:', err)
        setHasError(true)
        setStatus('보안 검증을 불러오지 못했습니다. 다시 시도해 주세요.')
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
        widgetIdRef.current = null
      }
    }
  }, [action, onVerify, siteKey, theme])

  useEffect(() => {
    if (previousResetNonceRef.current === resetNonce) return
    previousResetNonceRef.current = resetNonce

    if (widgetIdRef.current && window.turnstile) {
      window.turnstile.reset(widgetIdRef.current)
    }
    setHasError(false)
    setStatus('보안 검증을 다시 완료해 주세요.')
    onVerify(null)
  }, [onVerify, resetNonce])

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

  return (
    <div className="turnstile-container-wrapper">
      <div ref={containerRef} style={{ minHeight: '65px' }} />
      <p className="turnstile-status" role={hasError ? 'alert' : 'status'}>
        {status}
      </p>
    </div>
  )
}
