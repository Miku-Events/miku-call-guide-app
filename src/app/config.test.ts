import { describe, expect, it } from 'vitest'
import { isReadOnlySubmissionHostname } from './config'

describe('submission environment classification', () => {
  it.each([
    'miku-call-guide-app.pages.dev',
    'abc123.miku-call-guide-app.pages.dev',
    'PAGES.DEV.',
  ])('treats %s as a read-only Pages hostname', (hostname) => {
    expect(isReadOnlySubmissionHostname(hostname)).toBe(true)
  })

  it.each([
    'miku.sekai.today',
    'localhost',
    'pages.dev.example.test',
  ])('does not classify %s as a Pages preview', (hostname) => {
    expect(isReadOnlySubmissionHostname(hostname)).toBe(false)
  })
})
