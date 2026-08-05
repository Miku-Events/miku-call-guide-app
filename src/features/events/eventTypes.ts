import type { EventType } from '../data/types'

export type EventTokenColor = 'default' | 'red' | 'orange' | 'yellow' | 'green' | 'teal' | 'cyan' | 'blue' | 'purple' | 'pink' | 'gray'

export const eventTypePresentation: Record<EventType, {
  label: string
  shortLabel: string
  color: EventTokenColor
}> = {
  concert: { label: 'Concert', shortLabel: 'Concert', color: 'pink' },
  dj: { label: 'DJ', shortLabel: 'DJ', color: 'purple' },
  popup: { label: 'Popup', shortLabel: 'Popup', color: 'orange' },
  ticketApplication: { label: 'Ticket apply', shortLabel: 'Ticket', color: 'blue' },
  ticketGeneralSale: { label: 'General sale', shortLabel: 'General sale', color: 'blue' },
  livestream: { label: 'Livestream', shortLabel: 'Livestream', color: 'cyan' },
  exhibition: { label: 'Exhibition', shortLabel: 'Exhibition', color: 'yellow' },
  collaboration: { label: 'Collab', shortLabel: 'Collab', color: 'teal' },
  announcement: { label: 'Notice', shortLabel: 'Notice', color: 'red' },
  other: { label: 'Other', shortLabel: 'Other', color: 'gray' },
}

export const defaultEventTypePriority: EventType[] = [
  'concert',
  'ticketApplication',
  'ticketGeneralSale',
  'livestream',
  'dj',
  'popup',
  'exhibition',
  'collaboration',
  'announcement',
  'other',
]

export const eventTypeSelectorOptions = Object.entries(eventTypePresentation).map(([value, item]) => ({
  value,
  label: item.label,
}))

export function normalizeEventTypePriority(typePriority?: EventType[]): EventType[] {
  const supportedTypes = new Set(Object.keys(eventTypePresentation) as EventType[])
  const configured = (typePriority ?? []).filter(
    (type, index, values): type is EventType => supportedTypes.has(type) && values.indexOf(type) === index,
  )
  return [...configured, ...defaultEventTypePriority.filter((type) => !configured.includes(type))]
}
