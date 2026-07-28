import { lazy, Suspense } from 'react'
import { Route, Routes, useLocation } from 'react-router'
import { AppErrorBoundary } from './shared/errors/AppErrorBoundary'
import { NotFoundPage } from './shared/errors/NotFoundPage'
import { PageShellSkeleton } from './shared/layout/PageShellSkeleton'
import { SpoilerDisclaimerGate } from './features/spoilerDisclaimer/SpoilerDisclaimerGate'

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
  const location = useLocation()

  return (
    <SpoilerDisclaimerGate>
      <AppErrorBoundary resetKey={location.key}>
        <Suspense fallback={<PageShellSkeleton />}>
          <Routes>
            <Route path="/" element={<CatalogPage />} />
            <Route path="/songs/:songId" element={<CallGuidePage />} />
            <Route path="/events" element={<EventCalendarPage />} />
            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        </Suspense>
      </AppErrorBoundary>
    </SpoilerDisclaimerGate>
  )
}
