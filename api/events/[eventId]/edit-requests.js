import { createEditRequestIssue } from '../../_github.js'
import {
  apiError,
  handleOptions,
  json,
  readBody,
  requireMethod,
  respondWithError,
  setCors,
} from '../../_http.js'
import { readSession, requestEnvironment } from '../../_session.js'
import { verifyTurnstileToken } from '../../_turnstile.js'

async function handleEditRequest(req, res, {
  createIssue,
  readRequestSession,
  verifyToken,
}) {
  if (handleOptions(req, res)) {
    return
  }
  setCors(req, res)
  if (!requireMethod(req, res, 'POST')) {
    return
  }

  const environment = requestEnvironment(req)
  let session
  try {
    session = readRequestSession(req, environment)
  } catch (error) {
    respondWithError(req, res, error, {
      code: 'session_not_configured',
      status: 503,
    })
    return
  }
  if (!session?.login) {
    apiError(req, res, 401, 'github_login_required')
    return
  }
  req.authUser = session.login

  try {
    const body = readBody(req)

    const isValidToken = await verifyToken(body.turnstileToken, req, 'event_edit')
    if (!isValidToken) {
      apiError(req, res, 400, 'invalid_bot_token')
      return
    }

    const eventId = String(req.query.eventId || body.eventId || '')
    const message = String(body.message || '')
    if (!eventId || !message) {
      apiError(req, res, 400, 'invalid_edit_request', ['eventId and message are required'])
      return
    }

    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(eventId) || eventId.length > 100) {
      apiError(req, res, 400, 'invalid_event_id', ['eventId must be a valid slug (lowercase letters, numbers, hyphens) and 100 characters or less'])
      return
    }

    if (message.length > 2000) {
      apiError(req, res, 400, 'invalid_message', ['message must be 2000 characters or less'])
      return
    }

    if (body.occurrenceId && String(body.occurrenceId).length > 50) {
      apiError(req, res, 400, 'invalid_occurrence_id', ['occurrenceId must be 50 characters or less'])
      return
    }

    if (body.sourceUrl) {
      const sourceUrlStr = String(body.sourceUrl)
      if (sourceUrlStr.length > 500 || !/^https?:\/\//.test(sourceUrlStr)) {
        apiError(req, res, 400, 'invalid_source_url', ['sourceUrl must be a valid HTTP URL and 500 characters or less'])
        return
      }
    }

    const issue = await createIssue({
      eventId,
      message,
      occurrenceId: body.occurrenceId ? String(body.occurrenceId) : undefined,
      sourceUrl: body.sourceUrl ? String(body.sourceUrl) : undefined,
      submitter: session.login,
    }, environment)
    json(res, 200, { url: issue.html_url })
  } catch (error) {
    respondWithError(req, res, error, {
      code: 'github_upstream_failed',
      status: 502,
    })
  }
}

export function createEditRequestHandler(dependencies = {}) {
  const services = {
    createIssue: dependencies.createEditRequestIssue || createEditRequestIssue,
    readRequestSession: dependencies.readSession || readSession,
    verifyToken: dependencies.verifyTurnstileToken || verifyTurnstileToken,
  }

  return function handler(req, res) {
    return handleEditRequest(req, res, services)
  }
}

export default createEditRequestHandler()
