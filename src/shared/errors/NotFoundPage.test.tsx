import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NotFoundPage } from './NotFoundPage'

describe('NotFoundPage', () => {
  beforeEach(() => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({
      addEventListener: vi.fn(),
      matches: false,
      removeEventListener: vi.fn(),
    })))
  })

  it('offers a catalog recovery path', () => {
    render(<NotFoundPage />)

    expect(screen.getByRole('heading', { name: '페이지를 찾을 수 없습니다.' })).toBeInTheDocument()
    expect(screen.getByRole('main')).toHaveAttribute('id', 'astryx-app-shell-main')
    expect(screen.getByTestId('skip-to-content')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '카탈로그로 돌아가기' })).toHaveAttribute('href', '/')
  })
})
