import { createEventPullRequest } from '../../_github.js'
import { handleOptions, json, readBody, requireMethod, setCors } from '../../_http.js'
import { readSession } from '../../_session.js'

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

function eventYaml({ eventId, body, submitter }) {
  const title = String(body.title)
  const type = String(body.type)
  const startsAt = String(body.startsAt)
  const endsAt = body.endsAt ? String(body.endsAt) : ''
  const timezone = String(body.timezone)
  const snsUrl = String(body.snsUrl)
  const sourceUrl = body.sourceUrl ? String(body.sourceUrl) : snsUrl
  const note = body.note ? String(body.note) : ''

  return `schemaVersion: 1
id: ${eventId}
status: published

title:
  ko: ${yamlString(title)}

type: ${type}

occurrences:
  - id: main
    startsAt: ${yamlString(startsAt)}
${endsAt ? `    endsAt: ${yamlString(endsAt)}\n` : ''}    timezone: ${yamlString(timezone)}

links:
  sns:
    - platform: x
      url: ${yamlString(snsUrl)}
      embed: true
  source:
    url: ${yamlString(sourceUrl)}
    checkedAt: ${yamlString(new Date().toISOString())}

tags:
  - submitted

# submittedBy: ${submitter}
${note ? `# note: ${note.replace(/\r?\n/g, ' ')}\n` : ''}`
}

function validateBody(body) {
  const errors = []
  for (const key of ['title', 'type', 'startsAt', 'timezone', 'snsUrl']) {
    if (!body[key]) {
      errors.push(`${key} is required`)
    }
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
  if (body.snsUrl && !/^https?:\/\//.test(String(body.snsUrl))) {
    errors.push('snsUrl must be an HTTP URL')
  }
  if (body.sourceUrl && !/^https?:\/\//.test(String(body.sourceUrl))) {
    errors.push('sourceUrl must be an HTTP URL')
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
    const errors = validateBody(body)
    if (errors.length > 0) {
      json(res, 400, { error: 'invalid_event_submission', errors })
      return
    }

    const datePart = String(body.startsAt).slice(0, 10)
    const eventId = slugify(`${body.title}-${datePart}`) || `submitted-event-${Date.now()}`
    const branchName = `submissions/events/${eventId}-${Date.now()}`
    const pullRequest = await createEventPullRequest({
      branchName,
      content: eventYaml({ eventId, body, submitter: session.login }),
      eventId,
      submitter: session.login,
      title: String(body.title),
    })
    json(res, 200, { url: pullRequest.html_url })
  } catch (error) {
    json(res, 500, { error: error instanceof Error ? error.message : 'event_submission_failed' })
  }
}
