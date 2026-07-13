import type { MouseEvent, ReactNode } from 'react'

const ASTRYX_MAIN_ID = 'astryx-app-shell-main'
const ASTRYX_SKIP_HREF = `#${ASTRYX_MAIN_ID}`

interface HashRouterSkipLinkGuardProps {
  children: ReactNode
}

export function HashRouterSkipLinkGuard({ children }: HashRouterSkipLinkGuardProps) {
  const handleClickCapture = (event: MouseEvent<HTMLDivElement>) => {
    const target = event.target
    if (!(target instanceof Element)) return

    const link = target.closest<HTMLAnchorElement>('a[data-testid="skip-to-content"]')
    if (link?.getAttribute('href') !== ASTRYX_SKIP_HREF) return

    const main = document.getElementById(ASTRYX_MAIN_ID)
    if (!main) return

    event.preventDefault()
    main.setAttribute('tabindex', '-1')
    main.focus({ preventScroll: true })
    main.scrollIntoView({ block: 'start' })
  }

  return (
    <div onClickCapture={handleClickCapture} style={{ display: 'contents' }}>
      {children}
    </div>
  )
}
