import { exchangeOAuthCode, fetchGitHubUser } from '../../../_lib/github.js'
import { createApiHandler, HttpError, redirectResponse } from '../../../_lib/http.js'
import {
  clearAllOAuthTransactionCookies,
  clearOAuthTransactionCookie,
  constantTimeEqual,
  readOAuthTransaction,
  setSessionCookie,
  verifyState,
} from '../../../_lib/session.js'

export function createOAuthCallbackHandler(dependencies = {}) {
  const exchangeCode = dependencies.exchangeOAuthCode || exchangeOAuthCode
  const fetchUser = dependencies.fetchGitHubUser || fetchGitHubUser

  return createApiHandler({
    method: 'GET',
    fallback: { code: 'github_oauth_failed', status: 502 },
  }, async ({ request, env, headers }) => {
    try {
      clearOAuthTransactionCookie(headers, env)
    } catch {
      clearAllOAuthTransactionCookies(headers)
      throw new HttpError(503, 'github_oauth_not_configured')
    }

    const query = new URL(request.url).searchParams
    const queryState = query.get('state') || ''
    const code = query.get('code') || ''
    const state = verifyState(queryState, env)
    const transaction = readOAuthTransaction(request, env)
    if (!state || !transaction || !code || !constantTimeEqual(queryState, transaction.state)) {
      throw new HttpError(400, 'invalid_oauth_callback')
    }

    try {
      const accessToken = await exchangeCode(code, transaction.codeVerifier, env)
      const user = await fetchUser(accessToken, env)
      setSessionCookie(headers, { id: user.id, login: user.login, ts: Date.now() }, env)
      return redirectResponse(typeof state.returnTo === 'string' ? state.returnTo : '/', 302, headers)
    } catch (error) {
      if (error instanceof HttpError) {
        throw new HttpError(
          error.status === 503 ? 503 : 502,
          error.status === 503 ? 'github_oauth_unavailable' : 'github_oauth_failed',
        )
      }
      throw error
    }
  })
}

export const createCallbackHandler = createOAuthCallbackHandler
export const onRequest = createOAuthCallbackHandler()
