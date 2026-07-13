import type { CallEvent, EventOccurrence } from './types'

export const validTimedOccurrence = {
  id: 'probe-timed',
  startsAt: '2026-07-11T12:00:00+09:00',
  timezone: 'Asia/Seoul',
} satisfies EventOccurrence

// @ts-expect-error Event occurrences always require a timezone.
export const invalidOccurrence: EventOccurrence = {
  id: 'probe-invalid',
  startsOn: '2026-07-11',
}

// @ts-expect-error Timed and all-day occurrence fields are mutually exclusive.
export const invalidMixedOccurrence: EventOccurrence = {
  id: 'probe-mixed',
  startsAt: '2026-07-11T12:00:00+09:00',
  startsOn: '2026-07-11',
  timezone: 'Asia/Seoul',
}

// @ts-expect-error Global calls require timing, markers, and a null lyricLineId.
export const invalidGlobalCall: CallEvent = {
  id: 'probe-global',
  placement: { mode: 'globalTrack', lane: 'above', align: 'timeline' },
  text: { ko: '하이!' },
  activation: { mode: 'manualTime' },
  cue: { kind: 'chant', intensity: 'normal', repeat: 1 },
}
