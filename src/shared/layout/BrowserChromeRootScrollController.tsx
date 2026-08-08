import { useLayoutEffect } from 'react'

export const BROWSER_CHROME_ROOT_SCROLL_CLASS = 'browser-chrome-root-scroll'

interface BrowserChromeRootScrollControllerProps {
  active: boolean
  resetKey: string
}

function resetDocumentScroll(): void {
  document.documentElement.scrollTop = 0
  document.body.scrollTop = 0
}

export function BrowserChromeRootScrollController({
  active,
  resetKey,
}: BrowserChromeRootScrollControllerProps) {
  useLayoutEffect(() => {
    const root = document.documentElement

    if (!active) {
      root.classList.remove(BROWSER_CHROME_ROOT_SCROLL_CLASS)
      resetDocumentScroll()
      return
    }

    root.classList.add(BROWSER_CHROME_ROOT_SCROLL_CLASS)

    return () => {
      root.classList.remove(BROWSER_CHROME_ROOT_SCROLL_CLASS)
      resetDocumentScroll()
    }
  }, [active])

  useLayoutEffect(() => {
    if (active) {
      resetDocumentScroll()
    }
  }, [active, resetKey])

  return null
}
