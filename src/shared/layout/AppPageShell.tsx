import type { ReactNode } from 'react'
import { AppShell } from '@astryxdesign/core/AppShell'
import { Banner } from '@astryxdesign/core/Banner'
import { Layout, LayoutContent, LayoutHeader } from '@astryxdesign/core/Layout'
import { Toolbar } from '@astryxdesign/core/Toolbar'
import { Card } from '@astryxdesign/core/Card'
import { AppHeader } from './AppHeader'

export type { AppNavKey } from './AppHeader'
export type AppPageNavKey = 'catalog' | 'events'

export interface SummaryItem {
  icon?: ReactNode
  label: string
  value: string | number
}

export interface AppPageShellProps {
  activeNav: AppPageNavKey
  children: ReactNode
  className?: string
  kicker: string
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
  kicker,
  summaryItems,
  title,
  toolbar,
}: AppPageShellProps) {
  const titleId = `${activeNav}-page-title`

  return (
    <AppShell
      height="fill"
      variant="elevated"
      contentPadding={0}
      className={`app-page-shell${className ? ` ${className}` : ''}`}
      topNav={
        <AppHeader activeNav={activeNav} />
      }
    >
      <Layout className="app-main" aria-labelledby={titleId}>
        <LayoutHeader className="px-4">
          <div className="app-heading-row flex justify-between items-end w-full">
            <div>
              <p className="app-kicker">{kicker}</p>
              <h1 id={titleId}>{title}</h1>
            </div>
            <div className="app-summary-strip flex gap-2" aria-label={`${title} summary`}>
              {summaryItems.map((item) => {
                const innerContent = (
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center gap-1.5 text-xs text-[var(--color-text-secondary)] font-semibold">
                      {item.icon}
                      <span>{item.label}</span>
                    </div>
                    <strong className="text-lg text-[var(--color-text-teal)] mt-1">{item.value}</strong>
                  </div>
                )

                return (
                  <Card key={item.label} className="app-summary-item flex flex-col p-3 min-w-[7rem]">
                    {innerContent}
                  </Card>
                )
              })}
            </div>
          </div>
        </LayoutHeader>

        {toolbar && (
          <div className="mx-4 my-2 app-toolbar">
            <Toolbar
              label="Page actions"
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
