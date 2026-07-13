export type {
  CallGuideManifest,
  EventCalendarIndex,
  EventCalendarMonth,
  EventRegistry,
  EventType,
  LocalizedText,
  RootManifest,
  RuntimeEvent,
  RuntimeSong,
} from '../../../data-contracts/types.ts'

import type {
  CallGuideManifest,
  EventCalendarMonth,
  RuntimeEvent,
  RuntimeSong,
} from '../../../data-contracts/types.ts'

export type ManifestSong = CallGuideManifest['songs'][number]
export type Manifest = CallGuideManifest

export type EventOccurrence = RuntimeEvent['occurrences'][number]

export type EventLink = NonNullable<RuntimeEvent['links']['sns']>[number]
export type EventLinks = RuntimeEvent['links']
export type CalendarEventSummary = EventCalendarMonth['events'][number]
export type EventGuide = RuntimeEvent

export type LyricLine = RuntimeSong['lyrics'][number]
type ContractCallEvent = RuntimeSong['callEvents'][number]
export type CallPlacement = ContractCallEvent['placement']
export type CallAnchor = Extract<ContractCallEvent, { anchor: unknown }>['anchor']
export type CallMarkers = Extract<ContractCallEvent, { markers: unknown }>['markers']
export type CallSegment = Extract<ContractCallEvent, { segments: unknown }>['segments'][number]

export type CallEvent = ContractCallEvent

export type SongGuide = RuntimeSong

export type LoadSource = 'network' | 'cache'

export interface LoadResult<T> {
  data: T
  source: LoadSource
  warning?: string
}
