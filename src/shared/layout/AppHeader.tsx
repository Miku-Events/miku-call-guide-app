import type { ReactNode } from 'react'
import { GitHubMarkIcon } from '../icons/GitHubMarkIcon'

export type AppNavKey = 'catalog' | 'events' | 'practice'

export interface AppHeaderProps {
  activeNav: AppNavKey
  endContent?: ReactNode
  primaryAction?: ReactNode
}

export function AppHeader({ activeNav, endContent, primaryAction }: AppHeaderProps) {
  const isPlayer = activeNav === 'practice'
  const className = isPlayer ? 'player-top-bar' : 'app-top-bar'
  const practiceHref = typeof window === 'undefined' || window.location.hash.length === 0
    ? '#/'
    : window.location.hash
  const navItemClassName =
    'inline-flex min-h-touch-target items-center justify-center rounded-[var(--radius-inner)] px-3 text-sm font-semibold no-underline transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#39c5bb]'
  const selectedNavItemClassName = isPlayer
    ? 'bg-[var(--player-accent)] text-[#050506]'
    : 'bg-[var(--app-accent)] text-[#050506]'
  const inactiveNavItemClassName = isPlayer
    ? 'text-[var(--player-text-secondary)] hover:text-[var(--player-text)]'
    : 'text-[var(--app-text-secondary)] hover:text-[var(--app-text)]'

  const defaultEndContent = (
    <div className="flex items-center gap-3">
      {primaryAction}
      {(activeNav === 'catalog' || activeNav === 'events') && (
        <a
          aria-label="GitHub Repository"
          href="https://github.com/Miku-Events/miku-call-guide-app"
          className="app-github-link"
          rel="noopener noreferrer"
          target="_blank"
          title="GitHub Repository"
        >
          <GitHubMarkIcon size={20} />
        </a>
      )}
    </div>
  )
  const resolvedEndContent = endContent !== undefined ? endContent : defaultEndContent

  return (
    <header className={`${className} sticky top-0 z-10`}>
      <div className="flex h-full min-w-0 items-center gap-3 sm:gap-6">
        <a className="app-brand" href="#/">
          <span
            className="app-brand-mark"
            aria-hidden="true"
            style={{ background: isPlayer ? 'var(--player-accent)' : 'var(--app-accent)' }}
          />
          <span>Miku Call Guide</span>
        </a>

        <nav aria-label="Main navigation" className="flex min-w-0 items-center gap-1">
          <a
            aria-current={activeNav === 'catalog' ? 'page' : undefined}
            className={`${navItemClassName} ${activeNav === 'catalog' ? selectedNavItemClassName : inactiveNavItemClassName}`}
            data-active={activeNav === 'catalog' ? 'true' : 'false'}
            href="#/"
            style={activeNav === 'catalog' ? { color: '#050506' } : undefined}
          >
            Catalog
          </a>
          <a
            aria-current={activeNav === 'events' ? 'page' : undefined}
            className={`${navItemClassName} ${activeNav === 'events' ? selectedNavItemClassName : inactiveNavItemClassName}`}
            data-active={activeNav === 'events' ? 'true' : 'false'}
            href="#/events"
            style={activeNav === 'events' ? { color: '#050506' } : undefined}
          >
            Events
          </a>
          {isPlayer && (
            <a
              aria-current="page"
              className={`${navItemClassName} ${selectedNavItemClassName}`}
              data-active="true"
              href={practiceHref}
              style={{ color: '#050506' }}
            >
              Practice
            </a>
          )}
        </nav>

        {resolvedEndContent != null && (
          <div className="app-top-bar-action flex min-w-0 items-center">
            {resolvedEndContent}
          </div>
        )}
      </div>
    </header>
  )
}
