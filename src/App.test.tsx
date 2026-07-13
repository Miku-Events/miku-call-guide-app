import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, useNavigate } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'

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
  return <button onClick={() => navigate('/events')} type="button">Open events</button>
}

describe('App routes', () => {
  let consoleError: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    harness.catalogCrashes = false
    vi.stubGlobal('matchMedia', vi.fn(() => ({
      addEventListener: vi.fn(),
      matches: false,
      removeEventListener: vi.fn(),
    })))
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
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
})
