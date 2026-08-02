import type { ReactNode } from 'react'
import { AccessibleAppShell } from '../layout/AccessibleAppShell'
import { AppHeader } from '../layout/AppHeader'

interface RecoveryPageShellProps {
  children: ReactNode
}

export function RecoveryPageShell({ children }: RecoveryPageShellProps) {
  return (
    <AccessibleAppShell
      className="app-page-shell catalog-shell"
      topNav={<AppHeader activeNav="catalog" />}
    >
      {children}
    </AccessibleAppShell>
  )
}
