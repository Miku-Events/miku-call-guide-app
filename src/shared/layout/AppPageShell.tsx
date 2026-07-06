import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Github } from 'lucide-react'

export type AppNavKey = 'catalog' | 'events'

export interface SummaryItem {
  icon?: ReactNode
  label: string
  to?: string
  value: string | number
}

export interface AppPageShellProps {
  activeNav: AppNavKey
  children: ReactNode
  className?: string
  kicker: string
  primaryAction?: ReactNode
  summaryItems: SummaryItem[]
  title: string
  toolbar?: ReactNode
}

interface StatusBannerProps {
  action?: ReactNode
  children: ReactNode
  icon?: ReactNode
  role?: 'alert' | 'status'
  variant?: 'error' | 'info' | 'warning'
}

const navItems: Array<{ key: AppNavKey; label: string; to: string }> = [
  { key: 'catalog', label: 'Catalog', to: '/' },
  { key: 'events', label: 'Events', to: '/events' },
]

export function StatusBanner({ action, children, icon, role, variant = 'info' }: StatusBannerProps) {
  return (
    <div className="status-banner app-status-banner" data-variant={variant} role={role}>
      {icon}
      <p>{children}</p>
      {action}
    </div>
  )
}

export function AppPageShell({
  activeNav,
  children,
  className,
  kicker,
  primaryAction,
  summaryItems,
  title,
  toolbar,
}: AppPageShellProps) {
  const titleId = `${activeNav}-page-title`

  return (
    <main className={`app-shell app-page-shell${className ? ` ${className}` : ''}`}>
      <header className="app-top-bar sticky top-0 z-10">
        <div className="app-top-bar-inner">
          <Link className="app-brand" to="/">
            <span className="app-brand-mark" aria-hidden="true" />
            <span>Miku Call Guide</span>
          </Link>
          <nav className="app-nav" aria-label="Main navigation">
            {navItems.map((item) => (
              <Link data-active={activeNav === item.key} key={item.key} to={item.to}>
                {item.label}
              </Link>
            ))}
          </nav>
          <div className="app-top-bar-action" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            {primaryAction}
            <a
              href="https://github.com/Miku-Events/miku-call-guide-app"
              target="_blank"
              rel="noopener noreferrer"
              className="app-github-link"
              title="GitHub Repository"
              aria-label="GitHub Repository"
            >
              <Github size={20} />
            </a>
          </div>
        </div>
      </header>

      <section className="app-main" aria-labelledby={titleId}>
        <div className="app-heading-row">
          <div>
            <p className="app-kicker">{kicker}</p>
            <h1 id={titleId}>{title}</h1>
          </div>
          <div className="app-summary-strip" aria-label={`${title} summary`}>
            {summaryItems.map((item) => {
              const content = (
                <>
                  {item.icon}
                  <span>{item.label}</span>
                  <strong>{item.value}</strong>
                </>
              )

              return item.to ? (
                <Link className="app-summary-item" key={item.label} to={item.to}>
                  {content}
                </Link>
              ) : (
                <div className="app-summary-item" key={item.label}>
                  {content}
                </div>
              )
            })}
          </div>
        </div>

        {toolbar ? <div className="app-toolbar">{toolbar}</div> : null}
        {children}
      </section>
    </main>
  )
}
