import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { safeReturnTo } from '../../api/auth/github/start.js'
import { readBody } from '../../api/_http.js'
import { verifyState } from '../../api/_session.js'
import { validateBody } from '../../api/events/submissions/index.js'

describe('API Security Tests', () => {
  describe('safeReturnTo', () => {
    const originalEnv = process.env.APP_ORIGIN

    beforeEach(() => {
      delete process.env.APP_ORIGIN
    })

    afterEach(() => {
      process.env.APP_ORIGIN = originalEnv
    })

    it('returns fallback when no value is provided', () => {
      expect(safeReturnTo(null as any)).toBe('/')
      expect(safeReturnTo('')).toBe('/')
    })

    it('sanitizes Open Redirect bypass payloads containing backslashes', () => {
      expect(safeReturnTo('/\\\\evil.com')).toBe('/')
      expect(safeReturnTo('/\\evil.com')).toBe('/')
      expect(safeReturnTo('\\\\evil.com')).toBe('/')
    })

    it('allows valid relative paths when APP_ORIGIN is not set', () => {
      expect(safeReturnTo('/events')).toBe('/events')
      expect(safeReturnTo('/events/submissions?query=1')).toBe('/events/submissions?query=1')
    })

    it('enforces same-origin redirects when APP_ORIGIN is set', () => {
      process.env.APP_ORIGIN = 'https://miku-app.com'
      
      // Relative paths are allowed (resolved relative to APP_ORIGIN)
      expect(safeReturnTo('/events')).toBe('/events')
      
      // Absolute URLs matching APP_ORIGIN are resolved to relative paths
      expect(safeReturnTo('https://miku-app.com/foo?bar=baz')).toBe('/foo?bar=baz')
      
      // Absolute URLs of different origin are rejected
      expect(safeReturnTo('https://evil.com/foo')).toBe('https://miku-app.com')
    })
  })

  describe('readBody', () => {
    it('returns req.body as-is if it is an object', () => {
      const req = { body: { foo: 'bar' } }
      expect(readBody(req as any)).toEqual({ foo: 'bar' })
    })

    it('parses req.body if it is a valid JSON string', () => {
      const req = { body: '{"foo":"bar"}' }
      expect(readBody(req as any)).toEqual({ foo: 'bar' })
    })

    it('handles malformed JSON string gracefully without throwing', () => {
      const req = { body: '{"foo":' }
      expect(readBody(req as any)).toEqual({})
    })
  })

  describe('verifyState', () => {
    it('returns null on invalid signatures', () => {
      expect(verifyState('invalid-state')).toBeNull()
      expect(verifyState('')).toBeNull()
    })
  })

  describe('validateBody (Submissions)', () => {
    const validBase = {
      title: 'Hatsune Miku Concert',
      type: 'concert',
      timezone: 'Asia/Seoul',
      snsUrl: 'https://x.com/miku',
      startsAt: '2026-08-15T18:00:00Z',
    }

    it('passes validation with a valid body', () => {
      const errors = validateBody(validBase)
      expect(errors).toEqual([])
    })

    it('rejects title if too long', () => {
      const longTitle = 'a'.repeat(101)
      const errors = validateBody({ ...validBase, title: longTitle })
      expect(errors).toContain('title must be 100 characters or less')
    })

    it('rejects snsUrl if too long', () => {
      const longUrl = 'https://x.com/' + 'a'.repeat(500)
      const errors = validateBody({ ...validBase, snsUrl: longUrl })
      expect(errors).toContain('snsUrl must be 500 characters or less')
    })

    it('rejects note if too long', () => {
      const longNote = 'a'.repeat(1001)
      const errors = validateBody({ ...validBase, note: longNote })
      expect(errors).toContain('note must be 1000 characters or less')
    })
  })
})
