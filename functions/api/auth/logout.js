import { createApiHandler, emptyResponse } from '../../_lib/http.js'
import { clearAllAuthCookies } from '../../_lib/session.js'

export const onRequest = createApiHandler({ method: 'POST' }, ({ headers }) => {
  clearAllAuthCookies(headers)
  return emptyResponse(204, headers)
})
