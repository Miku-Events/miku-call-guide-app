import { createApiHandler, HttpError, redirectResponse } from '../../../_lib/http.js'
import {
  createOAuthTransaction,
  setOAuthTransactionCookie,
} from '../../../_lib/session.js'

export function safeReturnTo(value, environment) {
  const fallback = environment.APP_ORIGIN || '/'
  if (typeof value !== 'string' || !value) return fallback

  try {
    const baseOrigin = new URL(environment.APP_ORIGIN || 'http://localhost').origin
    const url = new URL(value, baseOrigin)
    if (url.origin === baseOrigin) return url.pathname + url.search + url.hash
  } catch {
    return fallback
  }
  return fallback
}

export const onRequest = createApiHandler({ method: 'GET' }, ({ request, env, headers }) => {
  const clientId = env.GITHUB_OAUTH_CLIENT_ID
  if (!clientId) throw new HttpError(503, 'github_oauth_not_configured')

  try {
    const returnTo = safeReturnTo(new URL(request.url).searchParams.get('returnTo'), env)
    const transaction = createOAuthTransaction(returnTo, env)
    setOAuthTransactionCookie(headers, transaction, env)
    const url = new URL('https://github.com/login/oauth/authorize')
    url.searchParams.set('client_id', clientId)
    url.searchParams.set('state', transaction.state)
    url.searchParams.set('code_challenge', transaction.codeChallenge)
    url.searchParams.set('code_challenge_method', 'S256')
    return redirectResponse(url.toString(), 302, headers)
  } catch (error) {
    if (error instanceof HttpError) throw error
    throw new HttpError(503, 'github_oauth_not_configured')
  }
})
