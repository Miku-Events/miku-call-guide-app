// @vitest-environment node

import { describe, expect, it } from 'vitest'
import { safeReturnTo } from '../../functions/api/auth/github/start.js'
import { readJsonBody } from '../../functions/_lib/http.js'
import { verifyState } from '../../functions/_lib/session.js'
import { validateBody } from '../../functions/api/events/submissions.js'

describe('API Security Tests', () => {
  describe('safeReturnTo', () => {
    const requestOrigin = 'http://localhost:5173'

    it('returns fallback when no value is provided', () => {
      expect(safeReturnTo(null, requestOrigin)).toBe('/')
      expect(safeReturnTo('', requestOrigin)).toBe('/')
    })

    it('sanitizes Open Redirect bypass payloads containing backslashes', () => {
      expect(safeReturnTo('/\\\\evil.com', requestOrigin)).toBe('/')
      expect(safeReturnTo('/\\evil.com', requestOrigin)).toBe('/')
      expect(safeReturnTo('\\\\evil.com', requestOrigin)).toBe('/')
      expect(safeReturnTo(`${requestOrigin}//evil.example/path`, requestOrigin)).toBe('/')
    })

    it('allows valid relative paths on the request origin', () => {
      expect(safeReturnTo('/events', requestOrigin)).toBe('/events')
      expect(safeReturnTo('/events/submissions?query=1', requestOrigin)).toBe('/events/submissions?query=1')
    })

    it('enforces same-origin redirects for the current request host', () => {
      expect(safeReturnTo('/events', 'https://miku-app.com')).toBe('/events')
      expect(safeReturnTo('https://miku-app.com/foo?bar=baz', 'https://miku-app.com')).toBe('/foo?bar=baz')
      expect(safeReturnTo('https://evil.com/foo', 'https://miku-app.com')).toBe('/')
    })
  })

  describe('readBody', () => {
    it('parses an object JSON request', async () => {
      const request = new Request('https://app.test/api', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"foo":"bar"}',
      })
      await expect(readJsonBody(request)).resolves.toEqual({ foo: 'bar' })
    })

    it('rejects malformed JSON strings', async () => {
      const request = new Request('https://app.test/api', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"foo":',
      })
      await expect(readJsonBody(request)).rejects.toThrow()
    })
  })

  describe('verifyState', () => {
    it('returns null on invalid signatures', () => {
      const environment = { SESSION_SECRET: 'test-secret-that-is-more-than-32-bytes' }
      expect(verifyState('invalid-state', environment)).toBeNull()
      expect(verifyState('', environment)).toBeNull()
    })
  })

  describe('validateBody (Submissions)', () => {
    const validBase = {
      attributionConsent: true,
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
