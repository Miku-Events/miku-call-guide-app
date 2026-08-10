import { EVENT_TYPES } from '../../../data-contracts/event-types.mjs'
import { createEventPullRequest } from '../../_lib/github.js'
import { requestIdempotencyKey, sha256Hex } from '../../_lib/idempotency.js'
import {
  normalizeGitHubSession,
  normalizeHttpsUrl,
  normalizeMultiline,
  normalizeSingleLine,
} from '../../_lib/input.js'
import { createApiHandler, HttpError, jsonResponse } from '../../_lib/http.js'
import { requireWriteRequest } from '../../_lib/runtimePolicy.js'
import { readSession } from '../../_lib/session.js'
import { verifyTurnstileToken } from '../../_lib/turnstile.js'

const supportedTypes = new Set(EVENT_TYPES)
const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const datePattern = /^\d{4}-\d{2}-\d{2}$/

function slugify(value) {
  return value.normalize('NFKD').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48)
}

function yamlString(value) {
  return JSON.stringify(value)
}

function appendResult(errors, normalized, key, result) {
  if (result.error) errors.push(result.error)
  else if (result.value !== undefined) normalized[key] = result.value
}

export function normalizeSubmissionBody(body) {
  const errors = []
  const normalized = {}
  appendResult(errors, normalized, 'title', normalizeSingleLine(body.title, 'title', {
    maxLength: 100,
    required: true,
  }))
  appendResult(errors, normalized, 'type', normalizeSingleLine(body.type, 'type', {
    maxLength: 50,
    required: true,
  }))
  appendResult(errors, normalized, 'timezone', normalizeSingleLine(body.timezone, 'timezone', {
    maxLength: 50,
    required: true,
  }))
  appendResult(errors, normalized, 'snsUrl', normalizeHttpsUrl(body.snsUrl, 'snsUrl', {
    allowedHosts: ['x.com', 'twitter.com'],
    maxLength: 500,
    required: true,
  }))
  appendResult(errors, normalized, 'sourceUrl', normalizeHttpsUrl(body.sourceUrl, 'sourceUrl', {
    maxLength: 500,
  }))
  appendResult(errors, normalized, 'note', normalizeMultiline(body.note, 'note', {
    maxLength: 1000,
  }))
  appendResult(errors, normalized, 'slug', normalizeSingleLine(body.slug, 'slug', {
    maxLength: 100,
    pattern: slugPattern,
    patternMessage: 'must contain only lowercase letters, numbers, and hyphens',
  }))
  for (const key of ['startsAt', 'endsAt', 'startsOn', 'endsOn']) {
    appendResult(errors, normalized, key, normalizeSingleLine(body[key], key, { maxLength: 40 }))
  }

  if (!normalized.startsAt && !normalized.startsOn) {
    errors.push('either startsAt or startsOn is required')
  }
  if (normalized.type && !supportedTypes.has(normalized.type)) {
    errors.push('type is not supported')
  }
  for (const key of ['startsAt', 'endsAt']) {
    if (normalized[key] && Number.isNaN(Date.parse(normalized[key]))) {
      errors.push(`${key} must be an ISO date-time`)
    }
  }
  for (const key of ['startsOn', 'endsOn']) {
    if (normalized[key] && !datePattern.test(normalized[key])) {
      errors.push(`${key} must be a date in YYYY-MM-DD format`)
    }
  }
  if (body.attributionConsent !== true) {
    errors.push('attributionConsent must be true')
  } else {
    normalized.attributionConsent = true
  }

  return { errors, value: normalized }
}

export function validateBody(body) {
  return normalizeSubmissionBody(body).errors
}

export function canonicalSubmissionPayload(body) {
  return JSON.stringify({
    attributionConsent: true,
    endsAt: body.endsAt || null,
    endsOn: body.endsOn || null,
    note: body.note || null,
    slug: body.slug || null,
    snsUrl: body.snsUrl,
    sourceUrl: body.sourceUrl || null,
    startsAt: body.startsAt || null,
    startsOn: body.startsOn || null,
    timezone: body.timezone,
    title: body.title,
    type: body.type,
  })
}

export function eventSubmissionFingerprint(actorId, canonicalPayload) {
  return sha256Hex(`event-submission\0${actorId}\0${canonicalPayload}`)
}

function eventYaml(body) {
  const occurrenceLines = body.startsAt
    ? [
        `    startsAt: ${yamlString(body.startsAt)}`,
        ...(body.endsAt ? [`    endsAt: ${yamlString(body.endsAt)}`] : []),
      ]
    : [
        `    startsOn: ${yamlString(body.startsOn)}`,
        ...(body.endsOn ? [`    endsOn: ${yamlString(body.endsOn)}`] : []),
      ]
  const note = body.note
    ? `${body.note.split('\n').map((line, index) => (
        index === 0 ? `# note: ${line}` : `#       ${line}`
      )).join('\n')}\n`
    : ''

  return `schemaVersion: 1
status: published

title:
  ko: ${yamlString(body.title)}

type: ${body.type}

occurrences:
  - id: main
${occurrenceLines.join('\n')}
    timezone: ${yamlString(body.timezone)}

links:
${body.sourceUrl ? `  official: ${yamlString(body.sourceUrl)}\n` : ''}  sns:
    - platform: x
      url: ${yamlString(body.snsUrl)}
      embed: true

tags:
  - submitted

${note}`
}

export function createSubmissionHandler(dependencies = {}) {
  const createPullRequest = dependencies.createEventPullRequest || createEventPullRequest
  const readRequestSession = dependencies.readSession || readSession
  const verifyToken = dependencies.verifyTurnstileToken || verifyTurnstileToken

  return createApiHandler({
    method: 'POST',
    jsonBody: true,
    audit: true,
    preflight: ({ request, env }) => requireWriteRequest(request, env),
    fallback: { code: 'github_upstream_failed', status: 502 },
  }, async (context) => {
    const { request, env, body, headers } = context

    let session
    try {
      session = normalizeGitHubSession(readRequestSession(request, env))
    } catch {
      throw new HttpError(503, 'session_not_configured')
    }
    if (!session) throw new HttpError(401, 'github_login_required')

    const validation = normalizeSubmissionBody(body)
    if (validation.errors.length > 0) {
      throw new HttpError(400, 'invalid_event_submission', validation.errors)
    }
    const normalizedBody = validation.value
    if (!await verifyToken(body.turnstileToken, request, env, 'event_submit')) {
      throw new HttpError(400, 'invalid_bot_token')
    }

    const datePart = (normalizedBody.startsAt || normalizedBody.startsOn).slice(0, 10)
    const year = datePart.slice(0, 4)
    const month = datePart.slice(5, 7)
    if (!/^\d{4}$/.test(year) || !/^(0[1-9]|1[0-2])$/.test(month)) {
      throw new HttpError(400, 'invalid_event_date_format', ['date must have a valid YYYY-MM prefix'])
    }

    const canonicalPayload = canonicalSubmissionPayload(normalizedBody)
    const fingerprint = eventSubmissionFingerprint(session.id, canonicalPayload)
    const eventId = normalizedBody.slug
      || slugify(`${normalizedBody.title}-${datePart}`)
      || `submitted-event-${fingerprint.slice(0, 12)}`
    const idempotencyKey = requestIdempotencyKey(
      request,
      session.id,
      canonicalPayload,
      dependencies.now?.() ?? Date.now(),
    )
    const pullRequest = await createPullRequest({
      branchName: `submissions/events/${eventId}-${fingerprint.slice(0, 24)}`,
      content: eventYaml(normalizedBody),
      eventId,
      filePath: `events/${year}/${month}/${eventId}.yaml`,
      fingerprint,
      idempotencyKey,
      submitter: session.login,
      title: normalizedBody.title,
    }, env)
    const replayed = pullRequest.replayed === true
    if (replayed) headers.set('idempotency-replayed', 'true')
    context.logMetadata.replay = replayed
    context.logMetadata.rollback = false
    context.resultCode = replayed ? 'submission_replayed' : 'submission_created'
    return jsonResponse({ url: pullRequest.html_url }, 200, headers)
  })
}

export const onRequest = createSubmissionHandler()
