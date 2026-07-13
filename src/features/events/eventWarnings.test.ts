import { describe, expect, it } from 'vitest'
import { eventPageWarning } from './eventWarnings'

describe('eventPageWarning', () => {
  it('combines index, month, and selected stale detail warnings', () => {
    expect(eventPageWarning(
      'index cache warning',
      'month stale warning',
      [{ id: 'selected-event' }],
      {
        'selected-event': { warning: 'detail stale warning' },
        'unselected-event': { warning: 'must stay hidden' },
      },
    )).toBe('index cache warning month stale warning detail stale warning')
  })

  it('does not expose warnings from details outside the current selection', () => {
    expect(eventPageWarning(
      undefined,
      undefined,
      [{ id: 'selected-event' }],
      {
        'selected-event': {},
        'unselected-event': { warning: 'must stay hidden' },
      },
    )).toBeUndefined()
  })
})
