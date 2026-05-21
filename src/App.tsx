import { Route, Routes } from 'react-router-dom'
import { CatalogPage } from './features/catalog/CatalogPage'
import { CallGuidePage } from './features/callGuide/CallGuidePage'
import { EventCalendarPage } from './features/events/EventCalendarPage'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<CatalogPage />} />
      <Route path="/songs/:songId" element={<CallGuidePage />} />
      <Route path="/events" element={<EventCalendarPage />} />
    </Routes>
  )
}
