import { describe, expect, it } from 'vitest'
import { nearestAvailableMonth } from './eventDate'

describe('nearestAvailableMonth', () => {
  const months = ['2026-05', '2026-06', '2026-07', '2026-08']

  it('finds the closest month with events when the visible month has none', () => {
    expect(nearestAvailableMonth(months, '2026-11')).toBe('2026-08')
    expect(nearestAvailableMonth(months, '2026-01')).toBe('2026-05')
  })

  it('prefers the upcoming month when two are equally close', () => {
    expect(nearestAvailableMonth(['2026-05', '2026-07'], '2026-06')).toBe('2026-07')
  })

  it('crosses year boundaries and ignores the visible month itself', () => {
    expect(nearestAvailableMonth(['2025-12', '2026-06'], '2026-01')).toBe('2025-12')
    expect(nearestAvailableMonth(['2026-06'], '2026-06')).toBeNull()
    expect(nearestAvailableMonth([], '2026-06')).toBeNull()
  })
})
