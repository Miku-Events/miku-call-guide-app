import { lazy, Suspense } from 'react'
import { matchPath, Route, Routes, useLocation } from 'react-router'
import { AppErrorBoundary } from './shared/errors/AppErrorBoundary'
import { NotFoundPage } from './shared/errors/NotFoundPage'
import { BrowserChromeRootScrollController } from './shared/layout/BrowserChromeRootScrollController'
import { PageShellSkeleton } from './shared/layout/PageShellSkeleton'
import { SpoilerDisclaimerGate } from './features/spoilerDisclaimer/SpoilerDisclaimerGate'
import { loadCallGuideRoute } from './features/callGuide/loadCallGuideRoute'
import { loadCatalogRoute } from './features/catalog/loadCatalogRoute'

const CatalogPage = lazy(() =>
  loadCatalogRoute().then((m) => ({ default: m.CatalogPage }))
)
const CallGuidePage = lazy(() =>
  loadCallGuideRoute().then((m) => ({ default: m.CallGuidePage }))
)
const EventCalendarPage = lazy(() =>
  import('./features/events/EventCalendarPage').then((m) => ({ default: m.EventCalendarPage }))
)

export default function App() {
  const location = useLocation()
  const usesBrowserChromeRootScroll = location.pathname === '/'
    || Boolean(matchPath('/songs/:songId', location.pathname))

  return (
    <SpoilerDisclaimerGate>
      <BrowserChromeRootScrollController
        active={usesBrowserChromeRootScroll}
        resetKey={location.pathname}
      />
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
