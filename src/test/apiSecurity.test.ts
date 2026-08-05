// @vitest-environment node

import { describe, expect, it } from 'vitest'
import { safeReturnTo } from '../../functions/api/auth/github/start.js'
import { readJsonBody } from '../../functions/_lib/http.js'
import { verifyState } from '../../functions/_lib/session.js'
import { validateBody } from '../../functions/api/events/submissions.js'

describe('API Security Tests', () => {
  describe('safeReturnTo', () => {
    const localEnv = {}

    it('returns fallback when no value is provided', () => {
      expect(safeReturnTo(null, localEnv)).toBe('/')
      expect(safeReturnTo('', localEnv)).toBe('/')
    })

    it('sanitizes Open Redirect bypass payloads containing backslashes', () => {
      expect(safeReturnTo('/\\\\evil.com', localEnv)).toBe('/')
      expect(safeReturnTo('/\\evil.com', localEnv)).toBe('/')
      expect(safeReturnTo('\\\\evil.com', localEnv)).toBe('/')
    })

    it('allows valid relative paths when APP_ORIGIN is not set', () => {
      expect(safeReturnTo('/events', localEnv)).toBe('/events')
      expect(safeReturnTo('/events/submissions?query=1', localEnv)).toBe('/events/submissions?query=1')
    })

    it('enforces same-origin redirects when APP_ORIGIN is set', () => {
      const environment = { APP_ORIGIN: 'https://miku-app.com' }
      
      // Relative paths are allowed (resolved relative to APP_ORIGIN)
      expect(safeReturnTo('/events', environment)).toBe('/events')
      
      // Absolute URLs matching APP_ORIGIN are resolved to relative paths
      expect(safeReturnTo('https://miku-app.com/foo?bar=baz', environment)).toBe('/foo?bar=baz')
      
      // Absolute URLs of different origin are rejected
      expect(safeReturnTo('https://evil.com/foo', environment)).toBe('https://miku-app.com')
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
