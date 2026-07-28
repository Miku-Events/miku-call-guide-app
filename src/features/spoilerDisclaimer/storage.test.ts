import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  isSpoilerDisclaimerAcknowledged,
  SPOILER_DISCLAIMER_ACKNOWLEDGED_VALUE,
  SPOILER_DISCLAIMER_STORAGE_KEY,
  storeSpoilerDisclaimerAcknowledgement,
} from './storage'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('spoiler disclaimer storage', () => {
  it('accepts only the exact acknowledgement sentinel', () => {
    const getItem = vi.fn(() => SPOILER_DISCLAIMER_ACKNOWLEDGED_VALUE)

    expect(isSpoilerDisclaimerAcknowledged({ getItem })).toBe(true)
    expect(getItem).toHaveBeenCalledWith(SPOILER_DISCLAIMER_STORAGE_KEY)

    for (const storedValue of [null, '', 'true', '01']) {
      expect(
        isSpoilerDisclaimerAcknowledged({
          getItem: () => storedValue,
        })
      ).toBe(false)
    }
  })

  it('fails closed when storage access or reads fail', () => {
    expect(
      isSpoilerDisclaimerAcknowledged({
        getItem: () => {
          throw new Error('blocked')
        },
      })
    ).toBe(false)

    vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
      throw new Error('blocked')
    })

    expect(isSpoilerDisclaimerAcknowledged()).toBe(false)
  })

  it('stores the exact acknowledgement and reports write failures', () => {
    const setItem = vi.fn()

    expect(storeSpoilerDisclaimerAcknowledgement({ setItem })).toBe(true)
    expect(setItem).toHaveBeenCalledWith(
      SPOILER_DISCLAIMER_STORAGE_KEY,
      SPOILER_DISCLAIMER_ACKNOWLEDGED_VALUE
    )

    expect(
      storeSpoilerDisclaimerAcknowledgement({
        setItem: () => {
          throw new Error('blocked')
        },
      })
    ).toBe(false)
  })
})
