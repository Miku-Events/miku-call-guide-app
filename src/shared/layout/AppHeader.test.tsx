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

    const link = screen.getByRole('link', { name: 'GitHub 저장소' })
    expect(link.tagName).toBe('A')
    expect(link).toHaveAttribute('href', 'https://github.com/Miku-Events/miku-call-guide-app')
    expect(within(link).queryAllByRole('button')).toHaveLength(0)
    expect(link.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
    expect(link.querySelector('svg')).toHaveAttribute('focusable', 'false')
  })

  it('keeps the HashRouter navigation and current practice item keyboard accessible', () => {
    window.location.hash = '#/songs/future-light-sample'

    render(<AppHeader activeNav="practice" />)

    expect(screen.getByRole('link', { name: '곡 목록' })).toHaveAttribute('href', '#/')
    expect(screen.getByRole('link', { name: '곡 목록' })).toHaveAttribute('data-active', 'false')
    expect(screen.getByRole('link', { name: '일정' })).toHaveAttribute('href', '#/events')
    expect(screen.getByRole('link', { name: '일정' })).toHaveAttribute('data-active', 'false')
    expect(screen.getByRole('link', { name: '콜 연습' })).toHaveAttribute(
      'href',
      '#/songs/future-light-sample',
    )
    expect(screen.getByRole('link', { name: '콜 연습' })).toHaveAttribute('aria-current', 'page')
  })
})
