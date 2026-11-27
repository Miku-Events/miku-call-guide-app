import type { EventType } from '../data/types'

export type EventTokenColor = 'default' | 'red' | 'orange' | 'yellow' | 'green' | 'teal' | 'cyan' | 'blue' | 'purple' | 'pink' | 'gray'

export const eventTypePresentation: Record<EventType, {
  label: string
  shortLabel: string
  color: EventTokenColor
}> = {
  concert: { label: '공연', shortLabel: '공연', color: 'pink' },
  dj: { label: 'DJ', shortLabel: 'DJ', color: 'purple' },
  popup: { label: '팝업 스토어', shortLabel: '팝업', color: 'orange' },
  ticketApplication: { label: '티켓 응모', shortLabel: '티켓', color: 'blue' },
  ticketGeneralSale: { label: '일반 판매', shortLabel: '일반 판매', color: 'blue' },
  livestream: { label: '생중계', shortLabel: '생중계', color: 'cyan' },
  exhibition: { label: '전시', shortLabel: '전시', color: 'yellow' },
  collaboration: { label: '콜라보', shortLabel: '콜라보', color: 'teal' },
  announcement: { label: '공지', shortLabel: '공지', color: 'red' },
  other: { label: '기타', shortLabel: '기타', color: 'gray' },
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
