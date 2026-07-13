import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PageShellSkeleton } from './PageShellSkeleton'

describe('PageShellSkeleton', () => {
  beforeEach(() => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({
      addEventListener: vi.fn(),
      matches: false,
      removeEventListener: vi.fn(),
    })))
  })

  it('announces route loading and marks its content busy', () => {
    render(<PageShellSkeleton />)

    expect(screen.getByTestId('page-shell-loading-content')).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByRole('status')).toHaveTextContent('페이지를 불러오는 중입니다.')
  })
})
