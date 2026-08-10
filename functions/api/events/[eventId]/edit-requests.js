import { createHash } from 'node:crypto'
import { createEditRequestIssue } from '../../../_lib/github.js'
import { requestIdempotencyKey } from '../../../_lib/idempotency.js'
import {
  normalizeGitHubSession,
  normalizeHttpsUrl,
  normalizeMultiline,
  normalizeSingleLine,
} from '../../../_lib/input.js'
import { createApiHandler, HttpError, jsonResponse } from '../../../_lib/http.js'
import { requireWriteRequest } from '../../../_lib/runtimePolicy.js'
import { readSession } from '../../../_lib/session.js'
import { verifyTurnstileToken } from '../../../_lib/turnstile.js'

const eventIdPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

function appendResult(errors, normalized, key, result) {
  if (result.error) errors.push(result.error)
  else if (result.value !== undefined) normalized[key] = result.value
}

export function normalizeEditRequestBody(body, routeEventId) {
  const errors = []
  const normalized = {}
  appendResult(errors, normalized, 'eventId', normalizeSingleLine(
    routeEventId || body.eventId,
    'eventId',
    {
      maxLength: 100,
      pattern: eventIdPattern,
      patternMessage: 'must be a valid slug (lowercase letters, numbers, hyphens)',
      required: true,
    },
  ))
  appendResult(errors, normalized, 'message', normalizeMultiline(body.message, 'message', {
    maxLength: 2000,
    required: true,
  }))
  appendResult(errors, normalized, 'occurrenceId', normalizeSingleLine(
    body.occurrenceId,
    'occurrenceId',
    {
      maxLength: 50,
      pattern: eventIdPattern,
      patternMessage: 'must be a valid slug (lowercase letters, numbers, hyphens)',
    },
  ))
  appendResult(errors, normalized, 'sourceUrl', normalizeHttpsUrl(body.sourceUrl, 'sourceUrl', {
    maxLength: 500,
  }))
  if (body.attributionConsent !== true) {
    errors.push('attributionConsent must be true')
  } else {
    normalized.attributionConsent = true
  }
  return { errors, value: normalized }
}

export function canonicalEditRequestPayload(body) {
  return JSON.stringify({
    attributionConsent: true,
    eventId: body.eventId,
    message: body.message,
    occurrenceId: body.occurrenceId || null,
    sourceUrl: body.sourceUrl || null,
  })
}

export function editRequestFingerprint(actorId, idempotencyKey, canonicalPayload) {
  return createHash('sha256')
    .update(`event-edit-request\0${actorId}\0${idempotencyKey}\0${canonicalPayload}`)
    .digest('hex')
}

export function createEditRequestHandler(dependencies = {}) {
  const createIssue = dependencies.createEditRequestIssue || createEditRequestIssue
  const readRequestSession = dependencies.readSession || readSession
  const verifyToken = dependencies.verifyTurnstileToken || verifyTurnstileToken

  return createApiHandler({
    method: 'POST',
    jsonBody: true,
    audit: true,
    preflight: ({ request, env }) => requireWriteRequest(request, env),
    fallback: { code: 'github_upstream_failed', status: 502 },
  }, async (context) => {
    const { request, env, params, body, headers } = context

    let session
    try {
      session = normalizeGitHubSession(readRequestSession(request, env))
    } catch {
      throw new HttpError(503, 'session_not_configured')
    }
    if (!session) throw new HttpError(401, 'github_login_required')

    const validation = normalizeEditRequestBody(body, params.eventId)
    if (validation.errors.length > 0) {
      throw new HttpError(400, 'invalid_edit_request', validation.errors)
    }
    const normalizedBody = validation.value
    if (!await verifyToken(body.turnstileToken, request, env, 'event_edit')) {
      throw new HttpError(400, 'invalid_bot_token')
    }

    const canonicalPayload = canonicalEditRequestPayload(normalizedBody)
    const idempotencyKey = requestIdempotencyKey(
      request,
      session.id,
      canonicalPayload,
      dependencies.now?.() ?? Date.now(),
    )
    const issue = await createIssue({
      ...normalizedBody,
      fingerprint: editRequestFingerprint(session.id, idempotencyKey, canonicalPayload),
      idempotencyKey,
      submitter: session.login,
    }, env)
    const replayed = issue.replayed === true
    if (replayed) headers.set('idempotency-replayed', 'true')
    context.logMetadata.replay = replayed
    context.logMetadata.rollback = false
    context.resultCode = replayed ? 'edit_request_replayed' : 'edit_request_created'
    return jsonResponse({ url: issue.html_url }, 200, headers)
  })
}

export const onRequest = createEditRequestHandler()
