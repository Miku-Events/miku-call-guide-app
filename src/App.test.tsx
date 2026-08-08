import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, useNavigate } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import {
  SPOILER_DISCLAIMER_ACKNOWLEDGED_VALUE,
  SPOILER_DISCLAIMER_STORAGE_KEY,
} from './features/spoilerDisclaimer/storage'

const harness = vi.hoisted(() => ({ catalogCrashes: false }))

vi.mock('./shared/layout/PageShellSkeleton', () => ({
  PageShellSkeleton: () => <p role="status">Loading route</p>,
}))
vi.mock('./features/catalog/CatalogPage', () => ({
  CatalogPage: () => {
    if (harness.catalogCrashes) throw new Error('catalog render failed')
    return <h1>Catalog route</h1>
  },
}))
vi.mock('./features/events/EventCalendarPage', () => ({
  EventCalendarPage: () => <h1>Events route</h1>,
}))
vi.mock('./features/callGuide/CallGuidePage', () => ({
  CallGuidePage: () => <h1>Song route</h1>,
}))

function RouteControl() {
  const navigate = useNavigate()
  return (
    <>
      <button onClick={() => navigate('/events')} type="button">Open events</button>
      <button onClick={() => navigate('/songs/song-a')} type="button">Open song</button>
    </>
  )
}

describe('App routes', () => {
  let consoleError: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    harness.catalogCrashes = false
    window.localStorage.setItem(
      SPOILER_DISCLAIMER_STORAGE_KEY,
      SPOILER_DISCLAIMER_ACKNOWLEDGED_VALUE,
    )
    vi.stubGlobal('matchMedia', vi.fn(() => ({
      addEventListener: vi.fn(),
      matches: false,
      removeEventListener: vi.fn(),
    })))
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    window.localStorage.removeItem(SPOILER_DISCLAIMER_STORAGE_KEY)
    document.documentElement.classList.remove('browser-chrome-root-scroll')
    document.documentElement.scrollTop = 0
    document.body.scrollTop = 0
    consoleError.mockRestore()
  })

  it('renders the not-found recovery page for an unknown route', async () => {
    render(
      <MemoryRouter initialEntries={['/does-not-exist']}>
        <App />
      </MemoryRouter>,
    )

    expect(await screen.findByRole('heading', { name: '페이지를 찾을 수 없습니다.' })).toBeInTheDocument()
  })

  it('resets a captured page error after navigation changes location', async () => {
    harness.catalogCrashes = true
    render(
      <MemoryRouter initialEntries={['/']}>
        <RouteControl />
        <App />
      </MemoryRouter>,
    )
    expect(await screen.findByRole('alert')).toHaveTextContent('페이지를 표시하지 못했습니다.')

    harness.catalogCrashes = false
    fireEvent.click(screen.getByRole('button', { name: 'Open events' }))

    expect(await screen.findByRole('heading', { name: 'Events route' })).toBeInTheDocument()
  })

  it('keeps document scrolling active between catalog and practice, then locks it on events', async () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <RouteControl />
        <App />
      </MemoryRouter>,
    )

    expect(await screen.findByRole('heading', { name: 'Catalog route' })).toBeInTheDocument()
    expect(document.documentElement).toHaveClass('browser-chrome-root-scroll')

    document.documentElement.scrollTop = 72
    document.body.scrollTop = 72
    fireEvent.click(screen.getByRole('button', { name: 'Open song' }))

    expect(await screen.findByRole('heading', { name: 'Song route' })).toBeInTheDocument()
    expect(document.documentElement).toHaveClass('browser-chrome-root-scroll')
    expect(document.documentElement.scrollTop).toBe(0)
    expect(document.body.scrollTop).toBe(0)

    document.documentElement.scrollTop = 72
    document.body.scrollTop = 72
    fireEvent.click(screen.getByRole('button', { name: 'Open events' }))

    expect(await screen.findByRole('heading', { name: 'Events route' })).toBeInTheDocument()
    expect(document.documentElement).not.toHaveClass('browser-chrome-root-scroll')
    expect(document.documentElement.scrollTop).toBe(0)
    expect(document.body.scrollTop).toBe(0)
  })
})
