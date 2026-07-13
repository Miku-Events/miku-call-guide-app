import {
  createOAuthTransaction,
  requestEnvironment,
  setOAuthTransactionCookie,
} from '../../_session.js'
import {
  apiError,
  handleOptions,
  requireMethod,
  setCors,
} from '../../_http.js'

export function safeReturnTo(value, environment = process.env) {
  const fallback = environment.APP_ORIGIN || '/'
  if (typeof value !== 'string' || !value) {
    return fallback
  }

  try {
    const base = environment.APP_ORIGIN || 'http://localhost'
    const baseOrigin = new URL(base).origin
    const url = new URL(value, baseOrigin)
    if (url.origin === baseOrigin) {
      return url.pathname + url.search + url.hash
    }
  } catch {
    return fallback
  }

  return fallback
}

export default function handler(req, res) {
  if (handleOptions(req, res)) {
    return
  }
  setCors(req, res)
  if (!requireMethod(req, res, 'GET')) {
    return
  }

  const environment = requestEnvironment(req)
  const clientId = environment.GITHUB_OAUTH_CLIENT_ID
  if (!clientId) {
    apiError(req, res, 503, 'github_oauth_not_configured')
    return
  }

  try {
    const returnTo = safeReturnTo(req.query.returnTo, environment)
    const transaction = createOAuthTransaction(returnTo, environment)
    setOAuthTransactionCookie(res, transaction, environment)

    const url = new URL('https://github.com/login/oauth/authorize')
    url.searchParams.set('client_id', clientId)
    url.searchParams.set('state', transaction.state)
    url.searchParams.set('code_challenge', transaction.codeChallenge)
    url.searchParams.set('code_challenge_method', 'S256')
    res.redirect(url.toString())
  } catch {
    apiError(req, res, 503, 'github_oauth_not_configured')
  }
}
