import type { ReactNode } from 'react'
import { AppShell } from '@astryxdesign/core/AppShell'
import { Banner } from '@astryxdesign/core/Banner'
import { Layout, LayoutContent, LayoutHeader } from '@astryxdesign/core/Layout'
import { Toolbar } from '@astryxdesign/core/Toolbar'
import { AppHeader } from './AppHeader'

type AppPageNavKey = 'catalog' | 'events' | 'privacy'

interface AppPageShellProps {
  activeNav: AppPageNavKey
  children: ReactNode
  className?: string
  height?: 'auto' | 'fill'
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



export function StatusBanner({ action, children, icon, role, variant = 'info' }: StatusBannerProps) {
  const status = variant === 'warning' ? 'warning' : variant === 'error' ? 'error' : 'info'

  return (
    <div className="app-status-banner">
      <Banner
        status={status}
        title={children}
        icon={icon}
        endContent={action}
        role={role}
        container="card"
      />
    </div>
  )
}

export function AppPageShell({
  activeNav,
  children,
  className,
  height = 'fill',
  title,
  toolbar,
}: AppPageShellProps) {
  const titleId = `${activeNav}-page-title`
  const resolvedClassName = [
    'app-page-shell',
    height === 'auto' ? 'app-page-shell--auto' : '',
    className ?? '',
  ].filter(Boolean).join(' ')

  return (
    <AppShell
      height={height}
      variant="elevated"
      contentPadding={0}
      className={resolvedClassName}
      topNav={
        <AppHeader activeNav={activeNav} />
      }
    >
      <Layout className="app-main" aria-labelledby={titleId} height={height}>
        <LayoutHeader className="px-4">
          <div className="app-heading-row">
            <h1 id={titleId}>{title}</h1>
          </div>
        </LayoutHeader>

        {toolbar && (
          <div className="mx-4 my-2 app-toolbar">
            <Toolbar
              label="페이지 도구"
              startContent={toolbar}
            />
          </div>
        )}

        <LayoutContent className="px-4">
          {children}
        </LayoutContent>
      </Layout>
    </AppShell>
  )
}
