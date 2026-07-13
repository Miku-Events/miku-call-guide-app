import { render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AppHeader } from './AppHeader'

describe('AppHeader', () => {
  beforeEach(() => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({
      addEventListener: vi.fn(),
      matches: false,
      removeEventListener: vi.fn(),
    })))
  })

  it('renders the GitHub action as one accessible link control', () => {
    render(<AppHeader activeNav="catalog" />)

    const link = screen.getByRole('link', { name: 'GitHub Repository' })
    expect(link.tagName).toBe('A')
    expect(link).toHaveAttribute('href', 'https://github.com/Miku-Events/miku-call-guide-app')
    expect(within(link).queryAllByRole('button')).toHaveLength(0)
  })
})
