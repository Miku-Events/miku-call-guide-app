import { describe, expect, it } from 'vitest'
import { getOffsetForTimezone, formatIsoWithOffset } from '../utils/timezone'

describe('EventSubmitDialog Timezone Helpers', () => {
  describe('getOffsetForTimezone', () => {
    it('returns +09:00 for Asia/Seoul and Asia/Tokyo', () => {
      expect(getOffsetForTimezone('Asia/Seoul', '2026-08-15T18:00')).toBe('+09:00')
      expect(getOffsetForTimezone('Asia/Tokyo', '2026-08-15T18:00')).toBe('+09:00')
    })

    it('returns +00:00 for UTC', () => {
      expect(getOffsetForTimezone('UTC', '2026-08-15T18:00')).toBe('+00:00')
    })

    it('returns DST-adjusted offset for America/New_York', () => {
      // In August, EDT (Daylight Saving Time) is active, which is UTC-4 (-04:00)
      expect(getOffsetForTimezone('America/New_York', '2026-08-15T18:00')).toBe('-04:00')
      
      // In December, EST (Standard Time) is active, which is UTC-5 (-05:00)
      expect(getOffsetForTimezone('America/New_York', '2026-12-15T18:00')).toBe('-05:00')
    })

    it('falls back gracefully to +00:00 for invalid inputs or invalid timezones', () => {
      expect(getOffsetForTimezone('Invalid/Timezone', '2026-08-15T18:00')).toBe('+00:00')
      expect(getOffsetForTimezone('Asia/Seoul', 'invalid-date')).toBe('+00:00')
    })
  })

  describe('formatIsoWithOffset', () => {
    it('correctly appends seconds and offset to datetime-local inputs', () => {
      expect(formatIsoWithOffset('2026-08-15T18:00', 'Asia/Seoul')).toBe('2026-08-15T18:00:00+09:00')
      expect(formatIsoWithOffset('2026-12-15T12:30', 'America/New_York')).toBe('2026-12-15T12:30:00-05:00')
    })

    it('returns empty string if localDateTime is empty', () => {
      expect(formatIsoWithOffset('', 'Asia/Seoul')).toBe('')
    })

    it('handles input already containing seconds', () => {
      expect(formatIsoWithOffset('2026-08-15T18:00:15', 'Asia/Seoul')).toBe('2026-08-15T18:00:15+09:00')
    })
  })
})
