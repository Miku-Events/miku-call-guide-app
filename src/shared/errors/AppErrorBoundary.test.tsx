import type { ReactNode } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppErrorBoundary } from './AppErrorBoundary'

let shouldThrow = true

function UnstableChild() {
  if (shouldThrow) {
    throw new Error('render failed')
  }
  return <p>Recovered content</p>
}

describe('AppErrorBoundary', () => {
  let consoleError: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    shouldThrow = true
    vi.stubGlobal('matchMedia', vi.fn(() => ({
      addEventListener: vi.fn(),
      matches: false,
      removeEventListener: vi.fn(),
    })))
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    consoleError.mockRestore()
  })

  it('keeps the fallback mounted while requesting a full-page retry', () => {
    const reloadPage = vi.fn()

    render(
      <AppErrorBoundary reloadPage={reloadPage} resetKey="catalog">
        <UnstableChild />
      </AppErrorBoundary>,
    )

    expect(screen.getByRole('alert')).toHaveTextContent('페이지를 표시하지 못했습니다.')
    expect(screen.getByRole('main')).toHaveAttribute('id', 'astryx-app-shell-main')
    expect(screen.getByTestId('skip-to-content')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '다시 시도' }))

    expect(reloadPage).toHaveBeenCalledOnce()
    expect(screen.getByRole('alert')).toHaveTextContent('페이지를 표시하지 못했습니다.')
  })

  it('clears the captured error when the route reset key changes', () => {
    const renderBoundary = (resetKey: string, children: ReactNode) => (
      <AppErrorBoundary resetKey={resetKey}>{children}</AppErrorBoundary>
    )
    const { rerender } = render(renderBoundary('catalog', <UnstableChild />))
    expect(screen.getByRole('alert')).toBeInTheDocument()

    shouldThrow = false
    rerender(renderBoundary('events', <UnstableChild />))

    expect(screen.getByText('Recovered content')).toBeInTheDocument()
  })
})
