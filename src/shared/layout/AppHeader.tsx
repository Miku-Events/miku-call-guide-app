import type { ReactNode } from 'react'
import { Github } from 'lucide-react'
import { TopNav, TopNavHeading, TopNavItem } from '@astryxdesign/core/TopNav'
import { IconButton } from '@astryxdesign/core/IconButton'

export type AppNavKey = 'catalog' | 'events' | 'practice'

export interface AppHeaderProps {
  activeNav: AppNavKey
  endContent?: ReactNode
  primaryAction?: ReactNode
}

export function AppHeader({ activeNav, endContent, primaryAction }: AppHeaderProps) {
  const isPlayer = activeNav === 'practice'
  const className = isPlayer ? 'player-top-bar' : 'app-top-bar'

  // Default endContent (with GitHub repository icon) for Catalog and Events pages
  const defaultEndContent = (
    <div className="flex items-center gap-3">
      {primaryAction}
      {(activeNav === 'catalog' || activeNav === 'events') && (
        <a
          href="https://github.com/Miku-Events/miku-call-guide-app"
          target="_blank"
          rel="noopener noreferrer"
          className="app-github-link"
          title="GitHub Repository"
          aria-label="GitHub Repository"
        >
          <IconButton
            icon={<Github size={20} />}
            label="GitHub Repository"
            variant="ghost"
          />
        </a>
      )}
    </div>
  )

  return (
    <TopNav
      label="Main navigation"
      className={className}
      heading={
        <div className="flex items-center gap-6">
          <TopNavHeading
            heading="Miku Call Guide"
            logo={<span className="app-brand-mark" aria-hidden="true" />}
            href="/"
          />
          <div className="flex items-center gap-4">
            <TopNavItem
              label="Catalog"
              href="/"
              isSelected={activeNav === 'catalog'}
              {...({ 'data-active': activeNav === 'catalog' ? 'true' : 'false' } as Record<string, string>)}
            />
            <TopNavItem
              label="Events"
              href="/events"
              isSelected={activeNav === 'events'}
              {...({ 'data-active': activeNav === 'events' ? 'true' : 'false' } as Record<string, string>)}
            />
            {isPlayer && (
              <TopNavItem
                label="Practice"
                href=""
                isSelected={activeNav === 'practice'}
                {...({ 'data-active': 'true' } as Record<string, string>)}
              />
            )}
          </div>
        </div>
      }
      endContent={endContent !== undefined ? endContent : defaultEndContent}
    />
  )
}
