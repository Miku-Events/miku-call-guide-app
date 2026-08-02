import type { ReactNode } from 'react'

export const APP_SHELL_MAIN_ID = 'astryx-app-shell-main'

interface AccessibleAppShellProps {
  children: ReactNode
  className: string
  topNav: ReactNode
}

/**
 * Lightweight shell for routes that do not use Astryx's side-nav or mobile
 * drawer features. It preserves the AppShell skip-link and main-landmark
 * contract without loading those unused navigation systems.
 */
export function AccessibleAppShell({ children, className, topNav }: AccessibleAppShellProps) {
  return (
    <div className={`flex min-h-0 flex-col overflow-hidden ${className}`}>
      <a
        className="app-skip-link"
        data-testid="skip-to-content"
        href={`#${APP_SHELL_MAIN_ID}`}
      >
        Skip to content
      </a>
      {topNav}
      <main
        className="flex min-h-0 flex-1 flex-col overflow-hidden"
        id={APP_SHELL_MAIN_ID}
        tabIndex={-1}
      >
        {children}
      </main>
    </div>
  )
}
