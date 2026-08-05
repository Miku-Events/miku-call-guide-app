import type { ReactNode } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const harness = vi.hoisted(() => ({
  latestResetNonce: 0,
  fetchSubmissionSession: vi.fn(),
  submitEventSubmission: vi.fn(),
  submitEditRequest: vi.fn(),
}))

vi.mock('../../../components/TurnstileWidget', () => ({
  TurnstileWidget: ({
    onVerify,
    resetNonce = 0,
  }: {
    onVerify: (token: string | null) => void
    resetNonce?: number
  }) => {
    harness.latestResetNonce = resetNonce
    return (
      <button onClick={() => onVerify('verified-token')} type="button">
        보안 검증 완료
      </button>
    )
  },
}))

vi.mock('../submissionClient', () => ({
  fetchSubmissionSession: harness.fetchSubmissionSession,
  githubLoginUrl: () => 'https://example.test/login',
  submitEventSubmission: harness.submitEventSubmission,
  submitEditRequest: harness.submitEditRequest,
}))

vi.mock('@astryxdesign/core/Dialog', () => ({
  Dialog: ({
    'aria-label': ariaLabel,
    children,
    isOpen,
  }: {
    'aria-label'?: string
    children: ReactNode
    isOpen: boolean
  }) => isOpen ? <div aria-label={ariaLabel} role="dialog">{children}</div> : null,
  DialogHeader: ({ title }: { title: string }) => <h2>{title}</h2>,
}))

vi.mock('@astryxdesign/core/TextInput', () => ({
  TextInput: ({ htmlName, label, value }: { htmlName: string; label: string; value: string }) => (
    <label>{label}<input name={htmlName} defaultValue={value} /></label>
  ),
}))

vi.mock('@astryxdesign/core/TextArea', () => ({
  TextArea: ({ htmlName, label, value }: { htmlName: string; label: string; value: string }) => (
    <label>{label}<textarea name={htmlName} defaultValue={value} /></label>
  ),
}))

vi.mock('@astryxdesign/core/Selector', () => ({
  Selector: ({ label, value }: { label: string; value: string }) => (
    <label>{label}<select aria-label={label} defaultValue={value}><option value={value}>{value}</option></select></label>
  ),
}))

vi.mock('@astryxdesign/core/Button', () => ({
  Button: ({
    isDisabled,
    label,
    onClick,
    type = 'button',
  }: {
    isDisabled?: boolean
    label: string
    onClick?: () => void
    type?: 'button' | 'submit'
  }) => <button disabled={isDisabled} onClick={onClick} type={type}>{label}</button>,
}))

vi.mock('@astryxdesign/core/EmptyState', () => ({
  EmptyState: ({ actions, description, title }: { actions?: ReactNode; description: string; title: string }) => (
    <div><h3>{title}</h3><p>{description}</p>{actions}</div>
  ),
}))

import { EventSubmitDialog } from './EventSubmitDialog'

async function renderDialog(overrides: Partial<React.ComponentProps<typeof EventSubmitDialog>> = {}) {
  const props: React.ComponentProps<typeof EventSubmitDialog> = {
    dialog: { kind: 'add' },
    setDialog: vi.fn(),
    setSubmissionSuccess: vi.fn(),
    submissionApiBaseUrl: 'https://example.test',
    ...overrides,
  }
  const view = render(<EventSubmitDialog {...props} />)
  await screen.findByRole('form', { name: '일정 추가 요청' })
  fireEvent.click(screen.getByRole('button', { name: '보안 검증 완료' }))
  return { ...view, props }
}

beforeEach(() => {
  harness.latestResetNonce = 0
  harness.submitEventSubmission.mockReset()
  harness.submitEditRequest.mockReset()
  harness.fetchSubmissionSession.mockReset()
  harness.fetchSubmissionSession.mockResolvedValue({ authenticated: true, login: 'miku-user' })
})

afterEach(cleanup)

describe('EventSubmitDialog recovery', () => {
  it('keeps submission failures in the open dialog and requires Turnstile re-verification', async () => {
    harness.submitEventSubmission.mockRejectedValue(new Error('요청이 거부되었습니다.'))
    const { props } = await renderDialog()

    fireEvent.submit(screen.getByRole('form', { name: '일정 추가 요청' }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('요청이 거부되었습니다.')
    expect(alert).toHaveTextContent('보안 검증을 다시 완료한 뒤 재시도해 주세요')
    expect(screen.getByRole('dialog')).toContainElement(alert)
    expect(props.setSubmissionSuccess).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'PR 요청' })).toBeDisabled()
    expect(harness.latestResetNonce).toBe(1)
  })

  it('clears a prior failure when the dialog is closed and reopened', async () => {
    harness.submitEventSubmission.mockRejectedValue(new Error('일시적인 실패'))
    const { props, rerender } = await renderDialog()

    fireEvent.submit(screen.getByRole('form', { name: '일정 추가 요청' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('일시적인 실패')

    rerender(<EventSubmitDialog {...props} dialog={null} />)
    rerender(<EventSubmitDialog {...props} dialog={{ kind: 'add' }} />)

    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
  })

  it('publishes only successful submissions to the page status region', async () => {
    harness.submitEventSubmission.mockResolvedValue({ url: 'https://github.test/pull/42' })
    const { props } = await renderDialog()

    fireEvent.submit(screen.getByRole('form', { name: '일정 추가 요청' }))

    await waitFor(() => {
      expect(props.setSubmissionSuccess).toHaveBeenCalledWith(
        'PR 생성 요청이 접수되었습니다: https://github.test/pull/42',
      )
    })
    expect(props.setDialog).toHaveBeenCalledWith(null)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('ignores a late failure from a dialog that was closed and reopened', async () => {
    let rejectSubmission: ((reason: Error) => void) | undefined
    harness.submitEventSubmission.mockImplementation(() => new Promise((_resolve, reject) => {
      rejectSubmission = reject
    }))
    const { props, rerender } = await renderDialog()

    fireEvent.submit(screen.getByRole('form', { name: '일정 추가 요청' }))
    await waitFor(() => expect(harness.submitEventSubmission).toHaveBeenCalledOnce())

    rerender(<EventSubmitDialog {...props} dialog={null} />)
    rerender(<EventSubmitDialog {...props} dialog={{ kind: 'add' }} />)

    await act(async () => {
      rejectSubmission?.(new Error('이전 요청의 늦은 실패'))
      await Promise.resolve()
    })

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(harness.latestResetNonce).toBe(0)
    expect(props.setSubmissionSuccess).not.toHaveBeenCalled()
  })
})
