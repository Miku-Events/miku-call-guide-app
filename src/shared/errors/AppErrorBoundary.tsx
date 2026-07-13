import { Component, type ReactNode } from 'react'
import { Button } from '@astryxdesign/core/Button'
import { RecoveryPageShell } from './RecoveryPageShell'

interface AppErrorBoundaryProps {
  children: ReactNode
  reloadPage?: () => void
  resetKey: string
}

interface AppErrorBoundaryState {
  hasError: boolean
}

export class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = { hasError: false }

  static getDerivedStateFromError(): AppErrorBoundaryState {
    return { hasError: true }
  }

  componentDidCatch() {
    // React reports the captured error; the fallback intentionally avoids exposing details to users.
  }

  componentDidUpdate(previousProps: AppErrorBoundaryProps) {
    if (this.state.hasError && previousProps.resetKey !== this.props.resetKey) {
      this.setState({ hasError: false })
    }
  }

  private readonly retry = () => {
    const reloadPage = this.props.reloadPage ?? (() => window.location.reload())
    reloadPage()
  }

  render() {
    if (this.state.hasError) {
      return (
        <RecoveryPageShell>
          <section className="mx-auto flex max-w-2xl flex-col gap-4 px-4 py-12" role="alert">
            <h1 className="text-2xl font-bold">페이지를 표시하지 못했습니다.</h1>
            <p className="text-[var(--color-text-secondary)]">
              일시적인 오류일 수 있습니다. 다시 시도하거나 카탈로그로 돌아가 주세요.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button label="다시 시도" onClick={this.retry} variant="secondary" />
              <Button href="/" label="카탈로그로 돌아가기" variant="ghost" />
            </div>
          </section>
        </RecoveryPageShell>
      )
    }

    return this.props.children
  }
}
