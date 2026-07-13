import { exchangeOAuthCode, fetchGitHubUser } from '../../_github.js'
import {
  apiError,
  handleOptions,
  HttpError,
  requireMethod,
  respondWithError,
  setCors,
} from '../../_http.js'
import {
  clearAllOAuthTransactionCookies,
  clearOAuthTransactionCookie,
  constantTimeEqual,
  readOAuthTransaction,
  requestEnvironment,
  setSessionCookie,
  verifyState,
} from '../../_session.js'

export function createCallbackHandler(dependencies = {}) {
  const exchangeCode = dependencies.exchangeOAuthCode || exchangeOAuthCode
  const fetchUser = dependencies.fetchGitHubUser || fetchGitHubUser

  return async function handler(req, res) {
    if (handleOptions(req, res)) {
      return
    }
    setCors(req, res)
    if (!requireMethod(req, res, 'GET')) {
      return
    }

    const environment = requestEnvironment(req)
    try {
      clearOAuthTransactionCookie(res, environment)
    } catch {
      clearAllOAuthTransactionCookies(res)
      apiError(req, res, 503, 'github_oauth_not_configured')
      return
    }

    try {
      const queryState = typeof req.query.state === 'string' ? req.query.state : ''
      const code = typeof req.query.code === 'string' ? req.query.code : ''
      const state = verifyState(queryState, environment)
      const transaction = readOAuthTransaction(req, environment)
      if (
        !state
        || !transaction
        || !code
        || !constantTimeEqual(queryState, transaction.state)
      ) {
        apiError(req, res, 400, 'invalid_oauth_callback')
        return
      }

      const accessToken = await exchangeCode(code, transaction.codeVerifier, environment)
      const user = await fetchUser(accessToken, environment)
      setSessionCookie(res, {
        id: user.id,
        login: user.login,
        ts: Date.now(),
      }, environment)
      res.redirect(typeof state.returnTo === 'string' ? state.returnTo : '/')
    } catch (error) {
      if (error instanceof HttpError && error.code !== 'github_oauth_not_configured') {
        respondWithError(req, res, new HttpError(
          error.status === 503 ? 503 : 502,
          error.status === 503 ? 'github_oauth_unavailable' : 'github_oauth_failed',
        ))
        return
      }
      respondWithError(req, res, error, {
        code: 'github_oauth_failed',
        status: 502,
      })
    }
  }
}

export default createCallbackHandler()
