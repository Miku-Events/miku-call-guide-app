import {
  createApiHandler,
  HttpError,
  redirectResponse,
  runtimeRequestOrigin,
} from '../../../_lib/http.js'
import {
  createOAuthTransaction,
  setOAuthTransactionCookie,
} from '../../../_lib/session.js'
import { requireOAuthRequest } from '../../../_lib/runtimePolicy.js'

export function safeReturnTo(value, origin) {
  if (typeof value !== 'string' || !value) return '/'

  try {
    const url = new URL(value, origin)
    if (
      url.origin === origin
      && url.pathname.startsWith('/')
      && !url.pathname.startsWith('//')
    ) {
      return url.pathname + url.search + url.hash
    }
  } catch {
    return '/'
  }
  return '/'
}

export const onRequest = createApiHandler({ method: 'GET' }, ({ request, env, headers }) => {
  requireOAuthRequest(request, env)
  const clientId = env.GITHUB_OAUTH_CLIENT_ID
  if (!clientId) throw new HttpError(503, 'github_oauth_not_configured')

  try {
    const origin = runtimeRequestOrigin(request, env)
    if (!origin) throw new Error('Invalid request origin')
    const redirectUri = new URL('/api/auth/github/callback', origin).toString()
    const returnTo = safeReturnTo(new URL(request.url).searchParams.get('returnTo'), origin)
    const transaction = createOAuthTransaction(returnTo, redirectUri, env)
    setOAuthTransactionCookie(headers, transaction, env)
    const url = new URL('https://github.com/login/oauth/authorize')
    url.searchParams.set('client_id', clientId)
    url.searchParams.set('redirect_uri', redirectUri)
    url.searchParams.set('state', transaction.state)
    url.searchParams.set('code_challenge', transaction.codeChallenge)
    url.searchParams.set('code_challenge_method', 'S256')
    return redirectResponse(url.toString(), 302, headers)
  } catch (error) {
    if (error instanceof HttpError) throw error
    throw new HttpError(503, 'github_oauth_not_configured')
  }
})
