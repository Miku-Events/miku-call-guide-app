import type { CalendarEventSummary, EventOccurrence } from '../data/types'

export type EventDialogState =
  | { kind: 'add' }
  | { kind: 'edit'; event: CalendarEventSummary; occurrence?: EventOccurrence }
  | null
