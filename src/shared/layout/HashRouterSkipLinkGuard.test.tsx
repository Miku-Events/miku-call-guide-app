import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { HashRouterSkipLinkGuard } from './HashRouterSkipLinkGuard'

describe('HashRouterSkipLinkGuard', () => {
  beforeEach(() => {
    window.location.hash = '#/events?mode=dark'
  })

  it('focuses and scrolls the Astryx main without replacing the router hash', () => {
    const scrollIntoView = vi.fn()
    render(
      <HashRouterSkipLinkGuard>
        <a data-testid="skip-to-content" href="#astryx-app-shell-main">Skip to content</a>
        <main id="astryx-app-shell-main" ref={(element) => {
          if (element) element.scrollIntoView = scrollIntoView
        }} />
      </HashRouterSkipLinkGuard>,
    )

    const wasNotCancelled = fireEvent.click(screen.getByTestId('skip-to-content'))
    const main = screen.getByRole('main')

    expect(wasNotCancelled).toBe(false)
    expect(window.location.hash).toBe('#/events?mode=dark')
    expect(main).toHaveFocus()
    expect(main).toHaveAttribute('tabindex', '-1')
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'start' })
  })
})
