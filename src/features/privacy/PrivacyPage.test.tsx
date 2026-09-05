import type { ReactNode } from 'react'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../../shared/layout/AppPageShell', () => ({
  AppPageShell: ({ children, title }: { children: ReactNode; title: string }) => (
    <main><h1>{title}</h1>{children}</main>
  ),
}))

import { PrivacyPage } from './PrivacyPage'

describe('PrivacyPage', () => {
  it('discloses Cloudflare Web Analytics without unrelated service data', () => {
    render(<PrivacyPage />)

    expect(screen.getByRole('heading', { name: '개인정보 처리 안내' })).toBeInTheDocument()
    expect(screen.getByText(/Cloudflare Web Analytics를 사용해 방문자 수, 방문 페이지와 성능 지표/)).toBeInTheDocument()
    expect(screen.getByText(/분석 데이터는 Cloudflare가 처리/)).toBeInTheDocument()
    expect(screen.getByText(/쿠키나 localStorage를 사용하지 않고/)).toBeInTheDocument()
    expect(screen.getByText(/개인 식별을 위한 핑거프린팅도 하지 않습니다/)).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/Google Analytics|_ga|Google Tag Gateway|Tag Gateway/)
    expect(document.body.textContent).not.toMatch(
      /제보|수정 요청|Pull Request|Issue|GitHub|OAuth|세션|로그아웃|Turnstile/i,
    )
    expect(document.body.textContent).not.toMatch(/\/api\/events|submission|report/i)
    expect(document.body.textContent).not.toMatch(
      /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i,
    )
  })
})
