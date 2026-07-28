import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import {
  SPOILER_DISCLAIMER_ACKNOWLEDGED_VALUE,
  SPOILER_DISCLAIMER_STORAGE_KEY,
} from './storage'
import { SpoilerDisclaimerGate } from './SpoilerDisclaimerGate'

const originalShowModal = Object.getOwnPropertyDescriptor(
  HTMLDialogElement.prototype,
  'showModal'
)
const originalClose = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'close')

beforeAll(() => {
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    configurable: true,
    value(this: HTMLDialogElement) {
      this.setAttribute('open', '')
    },
  })
  Object.defineProperty(HTMLDialogElement.prototype, 'close', {
    configurable: true,
    value(this: HTMLDialogElement) {
      this.removeAttribute('open')
    },
  })
})

afterAll(() => {
  if (originalShowModal) {
    Object.defineProperty(HTMLDialogElement.prototype, 'showModal', originalShowModal)
  } else {
    delete HTMLDialogElement.prototype.showModal
  }

  if (originalClose) {
    Object.defineProperty(HTMLDialogElement.prototype, 'close', originalClose)
  } else {
    delete HTMLDialogElement.prototype.close
  }
})

beforeEach(() => {
  window.localStorage.clear()
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined)
})

afterEach(() => {
  vi.restoreAllMocks()
})

function renderGate() {
  return render(
    <SpoilerDisclaimerGate>
      <main data-testid="protected-content">노래 목록</main>
    </SpoilerDisclaimerGate>
  )
}

describe('SpoilerDisclaimerGate', () => {
  it('renders only the required disclaimer before acknowledgement', () => {
    renderGate()

    const dialog = screen.getByRole('alertdialog', { name: '스포일러 안내' })
    const confirmButton = screen.getByRole('button', { name: '확인하고 계속하기' })

    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(dialog).toHaveAttribute('open')
    expect(screen.queryByTestId('protected-content')).not.toBeInTheDocument()
    expect(
      screen.getByText(/스포일러 노출을 줄이기 위해 카탈로그 첫 화면의 곡 목록은 무작위/)
    ).toHaveTextContent(/곡 자체가 스포일러로 느껴질 수 있으니/)
    expect(confirmButton).toHaveFocus()
  })

  it('cannot be dismissed with Escape or a backdrop click', () => {
    renderGate()
    const dialog = screen.getByRole('alertdialog', { name: '스포일러 안내' })

    fireEvent.keyDown(dialog, { key: 'Escape' })
    fireEvent.click(dialog)

    expect(screen.getByRole('alertdialog', { name: '스포일러 안내' })).toBeInTheDocument()
    expect(screen.queryByTestId('protected-content')).not.toBeInTheDocument()
  })

  it('stores acknowledgement and unlocks the current visit', () => {
    renderGate()

    fireEvent.click(screen.getByRole('button', { name: '확인하고 계속하기' }))

    expect(window.localStorage.getItem(SPOILER_DISCLAIMER_STORAGE_KEY)).toBe(
      SPOILER_DISCLAIMER_ACKNOWLEDGED_VALUE
    )
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(screen.getByTestId('protected-content')).toBeInTheDocument()
  })

  it('skips the disclaimer only for the exact stored sentinel', () => {
    window.localStorage.setItem(
      SPOILER_DISCLAIMER_STORAGE_KEY,
      SPOILER_DISCLAIMER_ACKNOWLEDGED_VALUE
    )
    const { unmount } = renderGate()

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(screen.getByTestId('protected-content')).toBeInTheDocument()

    unmount()
    window.localStorage.setItem(SPOILER_DISCLAIMER_STORAGE_KEY, 'true')
    renderGate()

    expect(screen.getByRole('alertdialog', { name: '스포일러 안내' })).toBeInTheDocument()
    expect(screen.queryByTestId('protected-content')).not.toBeInTheDocument()
  })

  it('shows the disclaimer when storage reads fail and still unlocks after a write failure', () => {
    vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
      throw new Error('blocked')
    })
    renderGate()

    expect(screen.getByRole('alertdialog', { name: '스포일러 안내' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '확인하고 계속하기' }))

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(screen.getByTestId('protected-content')).toBeInTheDocument()
  })
})
