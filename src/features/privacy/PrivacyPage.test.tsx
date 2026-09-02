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
  it('states the session, processor, and private submission policy', () => {
    render(<PrivacyPage />)

    expect(screen.getByRole('heading', { name: '개인정보 처리 안내' })).toBeInTheDocument()
    expect(screen.getByText(/변경되지 않는 사용자 ID와 현재 login/)).toBeInTheDocument()
    expect(screen.getByText(/세션은 발급 후 최대 7일/)).toBeInTheDocument()
    expect(screen.getByText(/OAuth access token은 callback에서 신원을 확인하는 데만 사용하고 별도로 저장하지 않습니다/)).toBeInTheDocument()
    expect(screen.getByText(/비공개 data 저장소의 Pull Request 또는 Issue/)).toBeInTheDocument()
    expect(screen.getByText(/이벤트 YAML에는 제출자의 GitHub login을 저장하지 않습니다/)).toBeInTheDocument()
    expect(screen.getByText(/공식 사이트에서는 모든 페이지의 방문 통계를 처리/)).toBeInTheDocument()
    const analyticsNotice = screen.getByText(/Google Analytics는 방문 페이지/)
    expect(analyticsNotice).toHaveTextContent(/_ga.*\.sekai\.today/)
    expect(screen.getByText(/주요 측정 요청은 Cloudflare/)).toBeInTheDocument()
    expect(screen.getByText(/태그 상태 확인 요청은 Google로 직접 전송/)).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(
      /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i,
    )
  })
})
