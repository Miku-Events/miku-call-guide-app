import { EVENT_TYPES } from '../../../data-contracts/event-types.mjs'
import { createEventPullRequest } from '../../_lib/github.js'
import { createApiHandler, HttpError, jsonResponse } from '../../_lib/http.js'
import { readSession } from '../../_lib/session.js'
import { verifyTurnstileToken } from '../../_lib/turnstile.js'

const supportedTypes = new Set(EVENT_TYPES)

function slugify(value) {
  return String(value).normalize('NFKD').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48)
}

function yamlString(value) {
  return JSON.stringify(String(value))
}

function eventYaml({ body, submitter }) {
  const startsAt = body.startsAt ? String(body.startsAt) : ''
  const endsAt = body.endsAt ? String(body.endsAt) : ''
  const startsOn = body.startsOn ? String(body.startsOn) : ''
  const endsOn = body.endsOn ? String(body.endsOn) : ''
  const sourceUrl = body.sourceUrl ? String(body.sourceUrl) : ''
  const note = body.note ? String(body.note) : ''
  const occurrenceLines = startsAt
    ? [`    startsAt: ${yamlString(startsAt)}`, ...(endsAt ? [`    endsAt: ${yamlString(endsAt)}`] : [])]
    : [`    startsOn: ${yamlString(startsOn)}`, ...(endsOn ? [`    endsOn: ${yamlString(endsOn)}`] : [])]

  return `schemaVersion: 1
status: published

title:
  ko: ${yamlString(body.title)}

type: ${String(body.type)}

occurrences:
  - id: main
${occurrenceLines.join('\n')}
    timezone: ${yamlString(body.timezone)}

links:
${sourceUrl ? `  official: ${yamlString(sourceUrl)}\n` : ''}  sns:
    - platform: x
      url: ${yamlString(body.snsUrl)}
      embed: true

tags:
  - submitted

# submittedBy: ${submitter}
${note ? `# note: ${note.replace(/\r?\n/g, ' ')}\n` : ''}`
}

export function validateBody(body) {
  const errors = []
  for (const key of ['title', 'type', 'timezone', 'snsUrl']) {
    if (!body[key]) errors.push(`${key} is required`)
  }
  if (body.title && String(body.title).length > 100) errors.push('title must be 100 characters or less')
  if (body.type && String(body.type).length > 50) errors.push('type must be 50 characters or less')
  if (body.timezone && String(body.timezone).length > 50) errors.push('timezone must be 50 characters or less')
  if (body.snsUrl && String(body.snsUrl).length > 500) errors.push('snsUrl must be 500 characters or less')
  if (body.sourceUrl && String(body.sourceUrl).length > 500) errors.push('sourceUrl must be 500 characters or less')
  if (body.note && String(body.note).length > 1000) errors.push('note must be 1000 characters or less')
  if (body.slug && String(body.slug).length > 100) errors.push('slug must be 100 characters or less')
  if (!body.startsAt && !body.startsOn) errors.push('either startsAt or startsOn is required')
  if (body.type && !supportedTypes.has(String(body.type))) errors.push('type is not supported')
  if (body.startsAt && Number.isNaN(Date.parse(String(body.startsAt)))) errors.push('startsAt must be an ISO date-time')
  if (body.endsAt && Number.isNaN(Date.parse(String(body.endsAt)))) errors.push('endsAt must be an ISO date-time')
  if (body.startsOn && !/^\d{4}-\d{2}-\d{2}$/.test(String(body.startsOn))) errors.push('startsOn must be a date in YYYY-MM-DD format')
  if (body.endsOn && !/^\d{4}-\d{2}-\d{2}$/.test(String(body.endsOn))) errors.push('endsOn must be a date in YYYY-MM-DD format')
  if (body.snsUrl && !/^https?:\/\//.test(String(body.snsUrl))) errors.push('snsUrl must be an HTTP URL')
  if (body.sourceUrl && !/^https?:\/\//.test(String(body.sourceUrl))) errors.push('sourceUrl must be an HTTP URL')
  if (body.slug && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(String(body.slug))) errors.push('slug must contain only lowercase letters, numbers, and hyphens')
  return errors
}

export function createSubmissionHandler(dependencies = {}) {
  const createPullRequest = dependencies.createEventPullRequest || createEventPullRequest
  const readRequestSession = dependencies.readSession || readSession
  const verifyToken = dependencies.verifyTurnstileToken || verifyTurnstileToken

  return createApiHandler({
    method: 'POST',
    jsonBody: true,
    fallback: { code: 'github_upstream_failed', status: 502 },
  }, async (context) => {
    const { request, env, body, headers } = context
    let session
    try {
      session = readRequestSession(request, env)
    } catch {
      throw new HttpError(503, 'session_not_configured')
    }
    if (!session?.login) throw new HttpError(401, 'github_login_required')
    context.authUser = session.login

    if (!await verifyToken(body.turnstileToken, request, env, 'event_submit')) {
      throw new HttpError(400, 'invalid_bot_token')
    }
    const errors = validateBody(body)
    if (errors.length > 0) throw new HttpError(400, 'invalid_event_submission', errors)

    const datePart = String(body.startsAt || body.startsOn || '').slice(0, 10)
    const year = datePart.slice(0, 4)
    const month = datePart.slice(5, 7)
    if (!/^\d{4}$/.test(year) || !/^(0[1-9]|1[0-2])$/.test(month)) {
      throw new HttpError(400, 'invalid_event_date_format', ['date must have a valid YYYY-MM prefix'])
    }

    const eventId = body.slug && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(String(body.slug))
      ? String(body.slug)
      : slugify(`${body.title}-${datePart}`) || `submitted-event-${Date.now()}`
    const pullRequest = await createPullRequest({
      branchName: `submissions/events/${eventId}-${Date.now()}`,
      content: eventYaml({ body, submitter: session.login }),
      filePath: `events/${year}/${month}/${eventId}.yaml`,
      submitter: session.login,
      title: String(body.title),
    }, env)
    return jsonResponse({ url: pullRequest.html_url }, 200, headers)
  })
}

export const onRequest = createSubmissionHandler()
