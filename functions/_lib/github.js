import { HttpError } from './http.js'
import { importGitHubAppPrivateKey } from './github-private-key.js'

const apiBase = 'https://api.github.com'
const TOKEN_EXPIRY_SKEW_MS = 60_000
const WRITE_RATE_LIMIT_FLOOR = 100
const DEFAULT_RATE_LIMIT_BLOCK_MS = 60_000
const tokenCache = new Map()
const tokenRequests = new Map()
let writeBlockedUntil = 0

export const GITHUB_TIMEOUT_MS = 10_000

class GitHubResponseError extends Error {
  constructor(status) {
    super('github_response_error')
    this.name = 'GitHubResponseError'
    this.status = status
  }
}

function requiredEnv(name, environment) {
  const value = environment?.[name]
  if (typeof value !== 'string' || !value) {
    throw new HttpError(
      503,
      name.startsWith('GITHUB_OAUTH_')
        ? 'github_oauth_not_configured'
        : 'github_app_not_configured',
    )
  }
  return value
}

function oauthRedirectUri(value) {
  try {
    const url = new URL(value)
    if (
      (url.protocol !== 'http:' && url.protocol !== 'https:')
      || url.username
      || url.password
      || url.pathname !== '/api/auth/github/callback'
      || url.search
      || url.hash
      || url.toString() !== value
    ) {
      throw new Error('Invalid OAuth redirect URI')
    }
    return value
  } catch {
    throw new HttpError(503, 'github_oauth_not_configured')
  }
}

function bytesToBase64(bytes) {
  let binary = ''
  for (let index = 0; index < bytes.byteLength; index += 1) {
    binary += String.fromCharCode(bytes[index])
  }
  return btoa(binary)
}

function base64UrlJson(value) {
  return bytesToBase64(new TextEncoder().encode(JSON.stringify(value)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

function base64Encode(value) {
  return bytesToBase64(new TextEncoder().encode(value))
}

function arrayBufferToBase64Url(buffer) {
  return bytesToBase64(new Uint8Array(buffer))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

async function appJwt(environment) {
  const now = Math.floor(Date.now() / 1000)
  const header = base64UrlJson({ alg: 'RS256', typ: 'JWT' })
  const payload = base64UrlJson({
    iat: now - 60,
    exp: now + 9 * 60,
    iss: requiredEnv('GITHUB_APP_ID', environment),
  })
  const content = `${header}.${payload}`
  const cryptoKey = await importGitHubAppPrivateKey(
    requiredEnv('GITHUB_APP_PRIVATE_KEY', environment),
  )
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    cryptoKey,
    new TextEncoder().encode(content),
  )
  return `${content}.${arrayBufferToBase64Url(signature)}`
}

function upstreamError(status = 502) {
  return new HttpError(
    status,
    status === 503 ? 'github_upstream_unavailable' : 'github_upstream_failed',
  )
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

async function withTimeout(externalSignal, operation) {
  const controller = new AbortController()
  const abortFromExternalSignal = () => controller.abort(externalSignal?.reason)
  if (externalSignal?.aborted) {
    abortFromExternalSignal()
  } else {
    externalSignal?.addEventListener('abort', abortFromExternalSignal, { once: true })
  }
  const abortPromise = new Promise((_resolve, reject) => {
    controller.signal.addEventListener('abort', () => reject(upstreamError(503)), { once: true })
  })
  const timeout = setTimeout(() => controller.abort(), GITHUB_TIMEOUT_MS)

  try {
    return await Promise.race([operation(controller.signal), abortPromise])
  } catch (error) {
    if (error instanceof HttpError || error instanceof GitHubResponseError) throw error
    if (controller.signal.aborted || error?.name === 'AbortError') throw upstreamError(503)
    throw upstreamError(502)
  } finally {
    clearTimeout(timeout)
    externalSignal?.removeEventListener('abort', abortFromExternalSignal)
  }
}

async function parseJsonResponse(response) {
  try {
    return await response.json()
  } catch {
    throw upstreamError(502)
  }
}

async function cancelResponseBody(response) {
  try {
    await response.body?.cancel()
  } catch {
    // The sanitized status classification still wins.
  }
}

function observeRateLimit(headers) {
  const remaining = Number.parseInt(headers.get('x-ratelimit-remaining') || '', 10)
  if (!Number.isFinite(remaining) || remaining >= WRITE_RATE_LIMIT_FLOOR) return

  const resetSeconds = Number.parseInt(headers.get('x-ratelimit-reset') || '', 10)
  const resetAt = Number.isFinite(resetSeconds) && resetSeconds > 0
    ? resetSeconds * 1000
    : Date.now() + DEFAULT_RATE_LIMIT_BLOCK_MS
  writeBlockedUntil = Math.max(writeBlockedUntil, resetAt)
}

function assertWriteCapacity() {
  if (writeBlockedUntil > Date.now()) {
    throw new HttpError(503, 'github_write_rate_limited')
  }
  writeBlockedUntil = 0
}

async function githubFetch(path, options = {}, acceptedStatuses = []) {
  return withTimeout(options.signal, async (signal) => {
    const response = await fetch(`${apiBase}${path}`, {
      ...options,
      headers: {
        accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
        'User-Agent': 'miku-call-guide-app',
        ...options.headers,
      },
      signal,
    })
    observeRateLimit(response.headers)

    if (acceptedStatuses.includes(response.status)) {
      await cancelResponseBody(response)
      return { data: null, status: response.status }
    }
    if (!response.ok) {
      await cancelResponseBody(response)
      throw new GitHubResponseError(response.status)
    }
    const data = response.status === 204 ? null : await parseJsonResponse(response)
    return { data, status: response.status }
  })
}

function mapGitHubError(error) {
  if (error instanceof HttpError) return error
  if (error instanceof GitHubResponseError) return upstreamError(502)
  return upstreamError(502)
}

function tokenCacheKey(environment) {
  return `${requiredEnv('GITHUB_APP_ID', environment)}:${requiredEnv('GITHUB_APP_INSTALLATION_ID', environment)}`
}

function invalidateInstallationToken(environment) {
  tokenCache.delete(tokenCacheKey(environment))
}

async function createInstallationToken(environment) {
  const installationId = requiredEnv('GITHUB_APP_INSTALLATION_ID', environment)
  let jwt
  try {
    jwt = await appJwt(environment)
  } catch (error) {
    if (error instanceof HttpError) throw error
    throw new HttpError(503, 'github_app_not_configured')
  }

  let response
  try {
    response = await githubFetch(`/app/installations/${encodeURIComponent(installationId)}/access_tokens`, {
      method: 'POST',
      headers: { authorization: `Bearer ${jwt}` },
    })
  } catch (error) {
    throw mapGitHubError(error)
  }
  const result = response.data
  if (!isRecord(result) || typeof result.token !== 'string' || !result.token) {
    throw upstreamError(502)
  }
  const expiresAt = Date.parse(typeof result.expires_at === 'string' ? result.expires_at : '')
  return {
    expiresAt: Number.isFinite(expiresAt) ? expiresAt : 0,
    token: result.token,
  }
}

export async function installationToken(environment, options = {}) {
  const key = tokenCacheKey(environment)
  if (options.forceRefresh) tokenCache.delete(key)

  const cached = tokenCache.get(key)
  if (cached && cached.expiresAt - TOKEN_EXPIRY_SKEW_MS > Date.now()) {
    return cached.token
  }
  if (!options.forceRefresh && tokenRequests.has(key)) {
    return tokenRequests.get(key)
  }

  const pending = createInstallationToken(environment)
    .then((created) => {
      if (created.expiresAt - TOKEN_EXPIRY_SKEW_MS > Date.now()) {
        tokenCache.set(key, created)
      }
      return created.token
    })
    .finally(() => tokenRequests.delete(key))
  tokenRequests.set(key, pending)
  return pending
}

async function installationRequest(
  path,
  options,
  environment,
  acceptedStatuses = [],
  { mutation = false } = {},
) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const token = await installationToken(environment, { forceRefresh: attempt > 0 })
    if (mutation) assertWriteCapacity()
    try {
      return await githubFetch(path, {
        ...options,
        headers: {
          ...options?.headers,
          authorization: `Bearer ${token}`,
        },
      }, acceptedStatuses)
    } catch (error) {
      if (error instanceof GitHubResponseError && error.status === 401 && attempt === 0) {
        invalidateInstallationToken(environment)
        continue
      }
      throw mapGitHubError(error)
    }
  }
  throw upstreamError(502)
}

export async function exchangeOAuthCode(code, codeVerifier, redirectUri, environment) {
  const callbackUrl = oauthRedirectUri(redirectUri)
  return withTimeout(undefined, async (signal) => {
    const response = await fetch('https://github.com/login/oauth/access_token', {
      body: JSON.stringify({
        client_id: requiredEnv('GITHUB_OAUTH_CLIENT_ID', environment),
        client_secret: requiredEnv('GITHUB_OAUTH_CLIENT_SECRET', environment),
        code,
        code_verifier: codeVerifier,
        redirect_uri: callbackUrl,
      }),
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'User-Agent': 'miku-call-guide-app',
      },
      method: 'POST',
      signal,
    })
    if (!response.ok) {
      await cancelResponseBody(response)
      throw upstreamError(502)
    }
    const data = await parseJsonResponse(response)
    if (!isRecord(data) || typeof data.access_token !== 'string' || !data.access_token) {
      throw upstreamError(502)
    }
    return data.access_token
  })
}

export async function fetchGitHubUser(accessToken, environment) {
  if (!environment || typeof environment !== 'object') {
    throw new HttpError(503, 'github_oauth_not_configured')
  }
  let response
  try {
    response = await githubFetch('/user', {
      headers: { authorization: `Bearer ${accessToken}` },
    })
  } catch (error) {
    throw mapGitHubError(error)
  }
  const user = response.data
  if (
    !isRecord(user)
    || (typeof user.id !== 'number' && typeof user.id !== 'string')
    || typeof user.login !== 'string'
    || !user.login
  ) {
    throw upstreamError(502)
  }
  return user
}

function validBaseBranch(value) {
  return /^[A-Za-z0-9](?:[A-Za-z0-9._/-]{0,198}[A-Za-z0-9])?$/.test(value)
    && !value.includes('..')
    && !value.includes('//')
    && !value.includes('@{')
}

export function repoConfig(environment) {
  const owner = requiredEnv('GITHUB_DATA_OWNER', environment)
  const repo = requiredEnv('GITHUB_DATA_REPO', environment)
  const baseBranch = environment.GITHUB_DATA_BASE_BRANCH || 'main'
  if (
    !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(owner)
    || !/^[A-Za-z0-9._-]{1,100}$/.test(repo)
    || !validBaseBranch(baseBranch)
  ) {
    throw new HttpError(503, 'github_app_not_configured')
  }
  return { owner, repo, baseBranch }
}

function repositoryPath(owner, repo) {
  return `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`
}

function refPath(branchName) {
  return branchName.split('/').map(encodeURIComponent).join('/')
}

function contentPath(filePath) {
  return filePath.split('/').map(encodeURIComponent).join('/')
}

async function getReference(repoPath, branchName, environment) {
  const response = await installationRequest(
    `${repoPath}/git/ref/heads/${refPath(branchName)}`,
    {},
    environment,
    [404],
  )
  if (response.status === 404) return null
  return isRecord(response.data) ? response.data : null
}

async function findPullRequest(repoPath, owner, branchName, environment) {
  const query = new URLSearchParams({
    head: `${owner}:${branchName}`,
    per_page: '10',
    state: 'all',
  })
  const response = await installationRequest(`${repoPath}/pulls?${query}`, {}, environment)
  if (!Array.isArray(response.data)) throw upstreamError(502)
  return response.data.find((pullRequest) => (
    isRecord(pullRequest)
    && typeof pullRequest.html_url === 'string'
    && pullRequest.html_url
  )) || null
}

async function deleteReference(repoPath, branchName, environment) {
  await installationRequest(
    `${repoPath}/git/refs/heads/${refPath(branchName)}`,
    { method: 'DELETE' },
    environment,
    [404],
  )
}

async function reconcilePullRequest(repoPath, owner, branchName, environment) {
  try {
    return {
      completed: true,
      pullRequest: await findPullRequest(repoPath, owner, branchName, environment),
    }
  } catch {
    return { completed: false, pullRequest: null }
  }
}

async function safeGetReference(repoPath, branchName, environment) {
  try {
    return await getReference(repoPath, branchName, environment)
  } catch {
    return null
  }
}

async function rollbackReference(repoPath, branchName, environment) {
  try {
    await deleteReference(repoPath, branchName, environment)
    return true
  } catch {
    return false
  }
}

function withRollbackMetadata(error, rollback) {
  const mapped = error instanceof HttpError ? error : upstreamError(502)
  mapped.logMetadata = { ...mapped.logMetadata, replay: false, rollback }
  return mapped
}

export async function createEventPullRequest({
  branchName,
  content,
  eventId,
  filePath,
  fingerprint,
  idempotencyKey,
  submitter,
  title,
}, environment) {
  assertWriteCapacity()
  const { owner, repo, baseBranch } = repoConfig(environment)
  const repoPath = repositoryPath(owner, repo)

  const baseFile = await installationRequest(
    `${repoPath}/contents/${contentPath(filePath)}?ref=${encodeURIComponent(baseBranch)}`,
    {},
    environment,
    [404],
  )
  if (baseFile.status !== 404) {
    throw new HttpError(409, 'submission_conflict', undefined, { replay: false, rollback: false })
  }

  const existingRef = await getReference(repoPath, branchName, environment)
  if (existingRef) {
    const existingPullRequest = await findPullRequest(repoPath, owner, branchName, environment)
    if (existingPullRequest) return { ...existingPullRequest, replayed: true }
    throw new HttpError(409, 'submission_in_progress', undefined, {
      replay: false,
      rollback: false,
    })
  }

  const baseRef = await getReference(repoPath, baseBranch, environment)
  if (typeof baseRef?.object?.sha !== 'string' || !baseRef.object.sha) {
    throw upstreamError(502)
  }
  assertWriteCapacity()

  let branchCreated = false
  try {
    await installationRequest(`${repoPath}/git/refs`, {
      body: JSON.stringify({
        ref: `refs/heads/${branchName}`,
        sha: baseRef.object.sha,
      }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    }, environment, [], { mutation: true })
    branchCreated = true
    assertWriteCapacity()

    await installationRequest(`${repoPath}/contents/${contentPath(filePath)}`, {
      body: JSON.stringify({
        branch: branchName,
        content: base64Encode(content),
        message: `Add event submission: ${eventId}`,
      }),
      headers: { 'content-type': 'application/json' },
      method: 'PUT',
    }, environment, [], { mutation: true })
    assertWriteCapacity()

    const pullResponse = await installationRequest(`${repoPath}/pulls`, {
      body: JSON.stringify({
        base: baseBranch,
        body: [
          'Submitted from the web event form.',
          '',
          `Submitted by: @${submitter}`,
          `<!-- miku-event-submission:${fingerprint} -->`,
          `<!-- idempotency-key:${idempotencyKey} -->`,
        ].join('\n'),
        head: branchName,
        title: `Add event: ${title}`,
      }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    }, environment, [], { mutation: true })
    const pullRequest = pullResponse.data
    if (!isRecord(pullRequest) || typeof pullRequest.html_url !== 'string' || !pullRequest.html_url) {
      throw upstreamError(502)
    }
    return { ...pullRequest, replayed: false }
  } catch (error) {
    const reconciliation = await reconcilePullRequest(repoPath, owner, branchName, environment)
    if (reconciliation.pullRequest) {
      return { ...reconciliation.pullRequest, replayed: true }
    }
    if (!reconciliation.completed) {
      throw withRollbackMetadata(error, false)
    }
    if (!branchCreated && await safeGetReference(repoPath, branchName, environment)) {
      throw new HttpError(409, 'submission_in_progress', undefined, {
        replay: false,
        rollback: false,
      })
    }
    const rollback = branchCreated
      ? await rollbackReference(repoPath, branchName, environment)
      : false
    throw withRollbackMetadata(error, rollback)
  }
}

function editRequestMarker(fingerprint) {
  return `<!-- miku-edit-request-fingerprint:${fingerprint} -->`
}

async function findEditRequestIssue(repoPath, fingerprint, environment) {
  const query = new URLSearchParams({
    direction: 'desc',
    labels: 'event-edit-request',
    per_page: '100',
    sort: 'created',
    state: 'all',
  })
  const response = await installationRequest(`${repoPath}/issues?${query}`, {}, environment)
  if (!Array.isArray(response.data)) throw upstreamError(502)
  const marker = editRequestMarker(fingerprint)
  return response.data.find((issue) => (
    isRecord(issue)
    && !issue.pull_request
    && typeof issue.body === 'string'
    && issue.body.includes(marker)
    && typeof issue.html_url === 'string'
    && issue.html_url
  )) || null
}

async function safeFindEditRequestIssue(repoPath, fingerprint, environment) {
  try {
    return await findEditRequestIssue(repoPath, fingerprint, environment)
  } catch {
    return null
  }
}

function indentedCodeBlock(message) {
  return message.split('\n').map((line) => `    ${line || ' '}`).join('\n')
}

export async function createEditRequestIssue({
  eventId,
  fingerprint,
  message,
  occurrenceId,
  sourceUrl,
  submitter,
}, environment) {
  assertWriteCapacity()
  const { owner, repo } = repoConfig(environment)
  const repoPath = repositoryPath(owner, repo)
  const existingIssue = await findEditRequestIssue(repoPath, fingerprint, environment)
  if (existingIssue) return { ...existingIssue, replayed: true }
  assertWriteCapacity()

  const body = [
    `Submitted by: @${submitter}`,
    `Event id: ${eventId}`,
    occurrenceId ? `Occurrence id: ${occurrenceId}` : null,
    sourceUrl ? `Source URL: ${sourceUrl}` : null,
    '',
    'Requested changes:',
    '',
    indentedCodeBlock(message),
    '',
    editRequestMarker(fingerprint),
  ].filter((line) => line !== null).join('\n')

  try {
    const response = await installationRequest(`${repoPath}/issues`, {
      body: JSON.stringify({
        body,
        labels: ['event-edit-request'],
        title: `Event edit request: ${eventId}`,
      }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    }, environment, [], { mutation: true })
    const issue = response.data
    if (!isRecord(issue) || typeof issue.html_url !== 'string' || !issue.html_url) {
      throw upstreamError(502)
    }
    return { ...issue, replayed: false }
  } catch (error) {
    const reconciled = await safeFindEditRequestIssue(repoPath, fingerprint, environment)
    if (reconciled) return { ...reconciled, replayed: true }
    const mapped = error instanceof HttpError ? error : upstreamError(502)
    mapped.logMetadata = { ...mapped.logMetadata, replay: false, rollback: false }
    throw mapped
  }
}

export function resetGitHubStateForTests() {
  tokenCache.clear()
  tokenRequests.clear()
  writeBlockedUntil = 0
}
