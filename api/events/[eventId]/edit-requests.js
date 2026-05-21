import { createEditRequestIssue } from '../../_github.js'
import { handleOptions, json, readBody, requireMethod, setCors } from '../../_http.js'
import { readSession } from '../../_session.js'

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
    const eventId = String(req.query.eventId || body.eventId || '')
    const message = String(body.message || '')
    if (!eventId || !message) {
      json(res, 400, { error: 'eventId and message are required' })
      return
    }

    const issue = await createEditRequestIssue({
      eventId,
      message,
      occurrenceId: body.occurrenceId ? String(body.occurrenceId) : undefined,
      sourceUrl: body.sourceUrl ? String(body.sourceUrl) : undefined,
      submitter: session.login,
    })
    json(res, 200, { url: issue.html_url })
  } catch (error) {
    json(res, 500, { error: error instanceof Error ? error.message : 'edit_request_failed' })
  }
}
