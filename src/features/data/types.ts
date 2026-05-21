export type LocalizedText = Record<string, string>
export type EventType =
  | 'concert'
  | 'dj'
  | 'popup'
  | 'ticketApplication'
  | 'ticketGeneralSale'
  | 'livestream'
  | 'exhibition'
  | 'collaboration'
  | 'announcement'
  | 'other'

export interface ManifestSong {
  id: string
  title: LocalizedText
  artist: LocalizedText
  youtubeVideoId: string
  originalSongId?: string
  tags: string[]
  path: string
  status: 'published'
  callSummary?: LocalizedText
}

export interface RootManifest {
  schemaVersion: 1
  generatedAt: string
  dataVersion: string
  manifests: {
    callGuide: string
    eventCalendar: string
  }
}

export interface CallGuideManifest {
  schemaVersion: 1
  generatedAt: string
  dataVersion: string
  songs: ManifestSong[]
}

export type Manifest = CallGuideManifest

export interface EventOccurrence {
  id: string
  label?: LocalizedText
  startsAt?: string
  endsAt?: string
  startsOn?: string
  endsOn?: string
  timezone: string
}

export interface EventLink {
  platform: 'x' | 'instagram' | 'youtube' | 'niconico' | 'tiktok' | 'facebook' | 'website' | 'other'
  url: string
  label?: LocalizedText
  embed?: boolean
}

export interface EventLinks {
  official?: string
  ticket?: string
  source?: {
    url?: string
    checkedAt?: string
  }
  sns?: EventLink[]
}

export interface CalendarEventSummary {
  id: string
  title: LocalizedText
  type: EventType
  occurrences: EventOccurrence[]
  path: string
}

export interface EventCalendarIndex {
  schemaVersion: 1
  generatedAt: string
  dataVersion: string
  availableMonths: string[]
  types: EventType[]
  typePriority?: EventType[]
}

export interface EventCalendarMonth {
  schemaVersion: 1
  generatedAt: string
  dataVersion: string
  month: string
  events: CalendarEventSummary[]
}

export interface EventGuide {
  schemaVersion: 1
  id: string
  status: 'draft' | 'reviewed' | 'published'
  title: LocalizedText
  type: EventType
  occurrences: EventOccurrence[]
  summary?: LocalizedText
  location?: {
    country?: string
    region?: LocalizedText
    venue?: LocalizedText
  }
  links: EventLinks
  tags?: string[]
  visibility?: {
    featured?: boolean
  }
}

export interface LyricLine {
  id: string
  srtIndex?: number
  time?: string
  startMs: number
  endMs: number
  text: LocalizedText
}

export interface CallPlacement {
  mode: 'lyricTrack' | 'globalTrack'
  lane: 'above' | 'below'
  align: 'charAnchor' | 'timeline'
}

export interface CallAnchor {
  targetText: string
  unit: 'grapheme'
  pointChar: number
  rangeStartChar?: number
  rangeEndChar?: number
}

export interface CallMarkers {
  point: {
    enabled: boolean
    style: 'pointArrow' | 'none'
    direction: 'auto' | 'up' | 'down'
  }
  range: {
    enabled: boolean
    style: 'bracket' | 'underline' | 'none'
  }
}

export interface CallSegment {
  lyricLineId: string
  part: 'start' | 'continue' | 'end'
  anchor: CallAnchor
  markers: CallMarkers
}

export interface CallEvent {
  id: string
  lyricLineId?: string | null
  time?: string
  startMs?: number
  endMs?: number
  placement: CallPlacement
  anchor?: CallAnchor
  text: LocalizedText
  markers?: CallMarkers
  segments?: CallSegment[]
  activation: {
    mode: 'lineActive' | 'manualTime'
  }
  cue: {
    kind: 'chant' | 'penlight' | 'custom'
    intensity: 'low' | 'normal' | 'high'
    repeat: number
  }
}

export interface SongGuide {
  schemaVersion: 1
  id: string
  status: 'draft' | 'reviewed' | 'published'
  metadata: {
    title: LocalizedText
    artist: LocalizedText
    vocal: string[]
    tags: string[]
  }
  youtube: {
    videoId: string
    startOffsetMs: number
  }
  display: {
    defaultLyricsLanguage: string
    defaultPronunciationLanguage: string
    defaultCallLanguage: string
  }
  timing: {
    unit: 'ms'
    durationMs: number
  }
  lyrics: LyricLine[]
  callEvents: CallEvent[]
  notes: {
    author: string
    source: string
    reviewComment: string
    copyrightNote: string
  }
}

export type LoadSource = 'network' | 'cache'

export interface LoadResult<T> {
  data: T
  source: LoadSource
  warning?: string
}
