import { createEventPullRequest } from '../../_github.js'
import { handleOptions, json, readBody, requireMethod, setCors } from '../../_http.js'
import { readSession } from '../../_session.js'
import { verifyTurnstileToken } from '../../_turnstile.js'

const supportedTypes = new Set([
  'concert',
  'dj',
  'popup',
  'ticketApplication',
  'ticketGeneralSale',
  'livestream',
  'exhibition',
  'collaboration',
  'announcement',
  'other',
])

function slugify(value) {
  return String(value)
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
}

function yamlString(value) {
  return JSON.stringify(String(value))
}

function eventYaml({ body, submitter }) {
  const title = String(body.title)
  const type = String(body.type)
  const startsAt = body.startsAt ? String(body.startsAt) : ''
  const endsAt = body.endsAt ? String(body.endsAt) : ''
  const startsOn = body.startsOn ? String(body.startsOn) : ''
  const endsOn = body.endsOn ? String(body.endsOn) : ''
  const timezone = String(body.timezone)
  const snsUrl = String(body.snsUrl)
  const sourceUrl = body.sourceUrl ? String(body.sourceUrl) : ''
  const note = body.note ? String(body.note) : ''

  const occurrenceLines = []
  if (startsAt) {
    occurrenceLines.push(`    startsAt: ${yamlString(startsAt)}`)
    if (endsAt) {
      occurrenceLines.push(`    endsAt: ${yamlString(endsAt)}`)
    }
  } else {
    occurrenceLines.push(`    startsOn: ${yamlString(startsOn)}`)
    if (endsOn) {
      occurrenceLines.push(`    endsOn: ${yamlString(endsOn)}`)
    }
  }

  return `schemaVersion: 1
status: published

title:
  ko: ${yamlString(title)}

type: ${type}

occurrences:
  - id: main
${occurrenceLines.join('\n')}
    timezone: ${yamlString(timezone)}

links:
${sourceUrl ? `  official: ${yamlString(sourceUrl)}\n` : ''}  sns:
    - platform: x
      url: ${yamlString(snsUrl)}
      embed: true

tags:
  - submitted

# submittedBy: ${submitter}
${note ? `# note: ${note.replace(/\r?\n/g, ' ')}\n` : ''}`
}

export function validateBody(body) {
  const errors = []
  for (const key of ['title', 'type', 'timezone', 'snsUrl']) {
    if (!body[key]) {
      errors.push(`${key} is required`)
    }
  }
  if (body.title && String(body.title).length > 100) {
    errors.push('title must be 100 characters or less')
  }
  if (body.type && String(body.type).length > 50) {
    errors.push('type must be 50 characters or less')
  }
  if (body.timezone && String(body.timezone).length > 50) {
    errors.push('timezone must be 50 characters or less')
  }
  if (body.snsUrl && String(body.snsUrl).length > 500) {
    errors.push('snsUrl must be 500 characters or less')
  }
  if (body.sourceUrl && String(body.sourceUrl).length > 500) {
    errors.push('sourceUrl must be 500 characters or less')
  }
  if (body.note && String(body.note).length > 1000) {
    errors.push('note must be 1000 characters or less')
  }
  if (body.slug && String(body.slug).length > 100) {
    errors.push('slug must be 100 characters or less')
  }
  if (!body.startsAt && !body.startsOn) {
    errors.push('either startsAt or startsOn is required')
  }
  if (body.type && !supportedTypes.has(String(body.type))) {
    errors.push('type is not supported')
  }
  if (body.startsAt && Number.isNaN(Date.parse(String(body.startsAt)))) {
    errors.push('startsAt must be an ISO date-time')
  }
  if (body.endsAt && Number.isNaN(Date.parse(String(body.endsAt)))) {
    errors.push('endsAt must be an ISO date-time')
  }
  if (body.startsOn && !/^\d{4}-\d{2}-\d{2}$/.test(String(body.startsOn))) {
    errors.push('startsOn must be a date in YYYY-MM-DD format')
  }
  if (body.endsOn && !/^\d{4}-\d{2}-\d{2}$/.test(String(body.endsOn))) {
    errors.push('endsOn must be a date in YYYY-MM-DD format')
  }
  if (body.snsUrl && !/^https?:\/\//.test(String(body.snsUrl))) {
    errors.push('snsUrl must be an HTTP URL')
  }
  if (body.sourceUrl && !/^https?:\/\//.test(String(body.sourceUrl))) {
    errors.push('sourceUrl must be an HTTP URL')
  }
  if (body.slug && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(String(body.slug))) {
    errors.push('slug must contain only lowercase letters, numbers, and hyphens')
  }
  return errors
}

export default async function handler(req, res) {
  if (handleOptions(req, res)) {
    return
  }
  setCors(req, res)
  if (!requireMethod(req, res, 'POST')) {
    return
  }

  const session = readSession(req)
  if (!session?.login) {
    json(res, 401, { error: 'github_login_required' })
    return
  }

  try {
    const body = readBody(req)

    const isValidToken = await verifyTurnstileToken(body.turnstileToken, req)
    if (!isValidToken) {
      json(res, 400, { error: 'invalid_bot_token', message: '보안 검증에 실패했습니다. 새로고침 후 다시 시도해 주세요.' })
      return
    }

    const errors = validateBody(body)
    if (errors.length > 0) {
      json(res, 400, { error: 'invalid_event_submission', errors })
      return
    }

    const datePart = String(body.startsAt || body.startsOn || '').slice(0, 10)
    const year = datePart.slice(0, 4)
    const month = datePart.slice(5, 7)

    if (!/^\d{4}$/.test(year) || !/^(0[1-9]|1[0-2])$/.test(month)) {
      json(res, 400, { error: 'invalid_event_date_format', errors: ['date must have a valid YYYY-MM prefix'] })
      return
    }

    const eventId = (body.slug && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(String(body.slug)))
      ? String(body.slug)
      : slugify(`${body.title}-${datePart}`) || `submitted-event-${Date.now()}`
    const targetFilePath = `events/${year}/${month}/${eventId}.yaml`
    const branchName = `submissions/events/${eventId}-${Date.now()}`
    const pullRequest = await createEventPullRequest({
      branchName,
      content: eventYaml({ body, submitter: session.login }),
      filePath: targetFilePath,
      submitter: session.login,
      title: String(body.title),
    })
    json(res, 200, { url: pullRequest.html_url })
  } catch (error) {
    json(res, 500, { error: error instanceof Error ? error.message : 'event_submission_failed' })
  }
}
