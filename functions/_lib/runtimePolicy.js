import { HttpError, runtimeRequestOrigin } from './http.js'
import { canonicalProductionOrigin } from './productionHostname.js'

function submissionWritesEnabled(environment) {
  if (environment?.APP_ENV === 'preview') return false
  if (environment?.APP_ENV === 'production') {
    return environment.SUBMISSION_WRITES_ENABLED === 'true'
  }
  return environment?.SUBMISSION_WRITES_ENABLED !== 'false'
}

function requireSubmissionWritesEnabled(environment) {
  if (!submissionWritesEnabled(environment)) {
    throw new HttpError(403, 'submissions_disabled')
  }
}

export function requireCanonicalProductionRequest(request, environment, options = {}) {
  if (environment?.APP_ENV !== 'production') return

  const configuredOrigin = canonicalProductionOrigin(environment.APP_ORIGIN)
  const requestUrlOrigin = runtimeRequestOrigin(request, environment)
  if (!configuredOrigin || requestUrlOrigin !== configuredOrigin) {
    throw new HttpError(403, 'invalid_request_origin')
  }
  if (options.requireOriginHeader && request.headers.get('origin') !== configuredOrigin) {
    throw new HttpError(403, 'invalid_request_origin')
  }
}

export function requireOAuthRequest(request, environment) {
  requireSubmissionWritesEnabled(environment)
  requireCanonicalProductionRequest(request, environment)
}

export function requireWriteRequest(request, environment) {
  requireSubmissionWritesEnabled(environment)
  requireCanonicalProductionRequest(request, environment, { requireOriginHeader: true })
}
