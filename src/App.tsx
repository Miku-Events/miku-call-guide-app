import { lazy, Suspense } from 'react'
import { Route, Routes } from 'react-router-dom'
import { PageShellSkeleton } from './shared/layout/PageShellSkeleton'

const CatalogPage = lazy(() =>
  import('./features/catalog/CatalogPage').then((m) => ({ default: m.CatalogPage }))
)
const CallGuidePage = lazy(() =>
  import('./features/callGuide/CallGuidePage').then((m) => ({ default: m.CallGuidePage }))
)
const EventCalendarPage = lazy(() =>
  import('./features/events/EventCalendarPage').then((m) => ({ default: m.EventCalendarPage }))
)

export default function App() {
  return (
    <Suspense fallback={<PageShellSkeleton />}>
      <Routes>
        <Route path="/" element={<CatalogPage />} />
        <Route path="/songs/:songId" element={<CallGuidePage />} />
        <Route path="/events" element={<EventCalendarPage />} />
      </Routes>
    </Suspense>
  )
}

