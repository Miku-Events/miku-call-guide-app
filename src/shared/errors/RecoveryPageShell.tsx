import type { ReactNode } from 'react'
import { AppShell } from '@astryxdesign/core/AppShell'
import { AppHeader } from '../layout/AppHeader'

interface RecoveryPageShellProps {
  children: ReactNode
}

export function RecoveryPageShell({ children }: RecoveryPageShellProps) {
  return (
    <AppShell
      className="catalog-shell"
      contentPadding={0}
      height="fill"
      topNav={<AppHeader activeNav="catalog" />}
      variant="elevated"
    >
      {children}
    </AppShell>
  )
}
