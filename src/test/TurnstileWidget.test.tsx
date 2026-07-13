import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TurnstileWidget } from '../components/TurnstileWidget'

describe('TurnstileWidget', () => {
  afterEach(() => {
    cleanup()
    delete window.turnstile
    delete window.onloadTurnstileCallback
    document
      .querySelectorAll('script[src*="challenges.cloudflare.com"]')
      .forEach((script) => script.remove())
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it.each(['event_submit', 'event_edit'] as const)(
    'passes the %s action to explicit rendering',
    async (action) => {
      const onVerify = vi.fn()
      const turnstileRender = vi.fn(() => 'widget-id')
      window.turnstile = {
        render: turnstileRender,
        reset: vi.fn(),
        remove: vi.fn(),
      }

      render(<TurnstileWidget action={action} onVerify={onVerify} />)

      await waitFor(() => expect(turnstileRender).toHaveBeenCalledOnce())
      expect(screen.getByRole('status')).toHaveTextContent('보안 검증이 필요합니다')
      const options = turnstileRender.mock.calls[0]?.[1]
      expect(options).toMatchObject({ action })

      act(() => options?.callback('verified-token'))
      expect(onVerify).toHaveBeenCalledWith('verified-token')
      expect(screen.getByRole('status')).toHaveTextContent('보안 검증이 완료되었습니다')
    },
  )

  it('resets the rendered widget and announces re-verification when resetNonce changes', async () => {
    const onVerify = vi.fn()
    const reset = vi.fn()
    const turnstileRender = vi.fn(() => 'widget-id')
    window.turnstile = {
      render: turnstileRender,
      reset,
      remove: vi.fn(),
    }

    const { rerender } = render(
      <TurnstileWidget action="event_submit" onVerify={onVerify} resetNonce={0} />,
    )
    await waitFor(() => expect(turnstileRender).toHaveBeenCalledOnce())

    rerender(<TurnstileWidget action="event_submit" onVerify={onVerify} resetNonce={1} />)

    await waitFor(() => expect(reset).toHaveBeenCalledWith('widget-id'))
    expect(onVerify).toHaveBeenLastCalledWith(null)
    expect(screen.getByRole('status')).toHaveTextContent('보안 검증을 다시 완료해 주세요')
  })

  it('announces a production configuration error and never renders or verifies without a site key', async () => {
    vi.stubEnv('DEV', false)
    vi.stubEnv('VITE_CLOUDFLARE_TURNSTILE_SITE_KEY', '')
    const onVerify = vi.fn()
    const turnstileRender = vi.fn(() => 'widget-id')
    window.turnstile = {
      render: turnstileRender,
      reset: vi.fn(),
      remove: vi.fn(),
    }

    render(<TurnstileWidget action="event_submit" onVerify={onVerify} />)

    expect(await screen.findByRole('alert')).toHaveTextContent('보안 검증 설정 오류')
    expect(turnstileRender).not.toHaveBeenCalled()
    expect(onVerify).not.toHaveBeenCalled()
  })
})
