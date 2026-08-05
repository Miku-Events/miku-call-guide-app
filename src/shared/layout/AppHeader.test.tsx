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

    const brand = screen.getByRole('link', { name: 'Miku Call Guide' })
    expect(brand).toHaveAttribute('href', '#/')
    expect(brand.querySelector('.app-brand-label')).toHaveTextContent('Miku Call Guide')

    const link = screen.getByRole('link', { name: 'GitHub Repository' })
    expect(link.tagName).toBe('A')
    expect(link).toHaveAttribute('href', 'https://github.com/Miku-Events/miku-call-guide-app')
    expect(within(link).queryAllByRole('button')).toHaveLength(0)
    expect(link.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
    expect(link.querySelector('svg')).toHaveAttribute('focusable', 'false')
  })

  it('keeps the HashRouter navigation and current practice item keyboard accessible', () => {
    window.location.hash = '#/songs/future-light-sample'

    render(<AppHeader activeNav="practice" />)

    expect(screen.getByRole('link', { name: 'Catalog' })).toHaveAttribute('href', '#/')
    expect(screen.getByRole('link', { name: 'Catalog' })).toHaveAttribute('data-active', 'false')
    expect(screen.getByRole('link', { name: 'Events' })).toHaveAttribute('href', '#/events')
    expect(screen.getByRole('link', { name: 'Events' })).toHaveAttribute('data-active', 'false')
    expect(screen.getByRole('link', { name: 'Practice' })).toHaveAttribute(
      'href',
      '#/songs/future-light-sample',
    )
    expect(screen.getByRole('link', { name: 'Practice' })).toHaveAttribute('aria-current', 'page')
  })
})
