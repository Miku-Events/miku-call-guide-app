import { describe, expect, it } from 'vitest'
import { localizedText } from './localizedText'

describe('localizedText', () => {
  it('prefers the requested locale before ordered fallbacks', () => {
    const text = { en: 'English', ja: '日本語', ko: '한국어' }

    expect(localizedText(text, 'ko', ['ja', 'en'])).toBe('한국어')
    expect(localizedText({ ...text, ko: '' }, 'ko', ['ja', 'en'])).toBe('日本語')
  })

  it('falls back to the first non-empty translation and handles missing text', () => {
    expect(localizedText({ fr: '', en: 'English' }, 'ko')).toBe('English')
    expect(localizedText(null, 'ko', ['ja', 'en'])).toBe('')
  })
})
