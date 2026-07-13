import { describe, expect, it } from 'vitest'
import { validateProductionDeployInputs } from './validate-production-deploy-inputs.mjs'

const releaseSha = '0123456789abcdef0123456789abcdef01234567'
const appOrigin = 'https://miku-call-guide-app.pages.dev'
const checklistUrl = `https://github.com/Miku-Events/miku-call-guide-app/blob/${releaseSha}/docs/operations-security.md`

function validInputs(overrides = {}) {
  return {
    appOrigin,
    githubRef: 'refs/heads/main',
    githubSha: releaseSha,
    hostnameConfirmation: 'miku-call-guide-app.pages.dev',
    operationsChecklistUrl: checklistUrl,
    releaseSha,
    ...overrides,
  }
}

describe('production deploy confirmation inputs', () => {
  it('binds an exact main commit, pages.dev hostname, checklist revision, and OAuth callback', () => {
    expect(validateProductionDeployInputs(validInputs())).toEqual({
      appOrigin,
      callbackUrl: `${appOrigin}/api/auth/github/callback`,
      hostname: 'miku-call-guide-app.pages.dev',
      operationsChecklistUrl: checklistUrl,
      releaseSha,
    })
  })

  it.each([
    ['a short release SHA', { releaseSha: '01234567' }],
    ['an uppercase release SHA', { releaseSha: releaseSha.toUpperCase() }],
    ['a release SHA different from the dispatched revision', { githubSha: 'f'.repeat(40) }],
    ['a non-main dispatch', { githubRef: 'refs/heads/release' }],
    ['a hostname typo', { hostnameConfirmation: 'other.pages.dev' }],
    ['an uppercase hostname confirmation', { hostnameConfirmation: 'MIKU-CALL-GUIDE-APP.PAGES.DEV' }],
    ['a custom production hostname', { appOrigin: 'https://app.miku-events.dev' }],
    ['an origin with a path', { appOrigin: `${appOrigin}/app` }],
    ['a checklist on a mutable branch', {
      operationsChecklistUrl: 'https://github.com/Miku-Events/miku-call-guide-app/blob/main/docs/operations-security.md',
    }],
    ['a checklist from another repository', {
      operationsChecklistUrl: `https://github.com/example/miku-call-guide-app/blob/${releaseSha}/docs/operations-security.md`,
    }],
    ['a checklist URL with a query', { operationsChecklistUrl: `${checklistUrl}?approved=true` }],
  ])('rejects %s', (_label, override) => {
    expect(() => validateProductionDeployInputs(validInputs(override))).toThrow()
  })
})
