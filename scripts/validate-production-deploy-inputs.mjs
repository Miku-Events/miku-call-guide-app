import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { canonicalProductionOrigin } from '../api/_production-hostname.js'

export const EXPECTED_PRODUCTION_HOSTNAME = 'miku-call-guide-app.pages.dev'
const FULL_SHA_PATTERN = /^[0-9a-f]{40}$/

function exactValue(value, name) {
  if (typeof value !== 'string' || value.length === 0 || value !== value.trim()) {
    throw new Error(`${name} is required without surrounding whitespace`)
  }
  return value
}

export function validateProductionDeployInputs({
  appOrigin,
  githubRef,
  githubSha,
  hostnameConfirmation,
  operationsChecklistUrl,
  releaseSha,
} = {}) {
  const normalizedReleaseSha = exactValue(releaseSha, 'release_sha')
  if (!FULL_SHA_PATTERN.test(normalizedReleaseSha)) {
    throw new Error('release_sha must be a full lowercase 40-character commit SHA')
  }
  if (githubRef !== 'refs/heads/main') {
    throw new Error('Production deployment must be dispatched from main')
  }
  if (githubSha !== normalizedReleaseSha) {
    throw new Error('release_sha must exactly match the dispatched main revision')
  }

  const normalizedOrigin = exactValue(appOrigin, 'VITE_APP_ORIGIN')
  if (canonicalProductionOrigin(normalizedOrigin) !== normalizedOrigin) {
    throw new Error('VITE_APP_ORIGIN must be an exact canonical HTTPS origin')
  }
  const hostname = new URL(normalizedOrigin).hostname
  if (hostname !== EXPECTED_PRODUCTION_HOSTNAME) {
    throw new Error(`VITE_APP_ORIGIN must use ${EXPECTED_PRODUCTION_HOSTNAME}`)
  }
  if (hostnameConfirmation !== hostname) {
    throw new Error('production_hostname_confirmation must exactly match the production hostname')
  }

  const expectedChecklistUrl = [
    'https://github.com/Miku-Events/miku-call-guide-app/blob',
    normalizedReleaseSha,
    'docs/operations-security.md',
  ].join('/')
  if (operationsChecklistUrl !== expectedChecklistUrl) {
    throw new Error('operations_checklist_url must reference this exact release SHA and checklist path')
  }

  return {
    appOrigin: normalizedOrigin,
    callbackUrl: `${normalizedOrigin}/api/auth/github/callback`,
    hostname,
    operationsChecklistUrl: expectedChecklistUrl,
    releaseSha: normalizedReleaseSha,
  }
}

function formatReport(result) {
  return [
    'Production deploy confirmations: PASS',
    `- release: ${result.releaseSha}`,
    `- hostname: ${result.hostname}`,
    `- OAuth callback: ${result.callbackUrl}`,
    `- checklist: ${result.operationsChecklistUrl}`,
  ].join('\n')
}

function runCli() {
  const result = validateProductionDeployInputs({
    appOrigin: process.env.PRODUCTION_APP_ORIGIN,
    githubRef: process.env.GITHUB_REF,
    githubSha: process.env.GITHUB_SHA,
    hostnameConfirmation: process.env.PRODUCTION_HOSTNAME_CONFIRMATION,
    operationsChecklistUrl: process.env.OPERATIONS_CHECKLIST_URL,
    releaseSha: process.env.RELEASE_SHA,
  })
  process.stdout.write(`${formatReport(result)}\n`)
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : ''
if (invokedPath === import.meta.url) {
  try {
    runCli()
  } catch (error) {
    process.stderr.write(
      `Production deploy confirmations: FAIL\n${error instanceof Error ? error.message : String(error)}\n`,
    )
    process.exitCode = 1
  }
}
