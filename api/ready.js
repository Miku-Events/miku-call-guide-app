import {
  handleOptions,
  HttpError,
  json,
  requireMethod,
  respondWithError,
} from './_http.js'
import {
  assertProductionReadiness,
  READINESS_CONTRACT_HEADER,
  READINESS_CONTRACT_VERSION,
} from './_readiness.js'
import { requestEnvironment } from './_session.js'

export default async function handler(req, res) {
  res.setHeader(READINESS_CONTRACT_HEADER, READINESS_CONTRACT_VERSION)
  if (handleOptions(req, res)) {
    return
  }
  if (!requireMethod(req, res, 'GET')) {
    return
  }

  try {
    await assertProductionReadiness(requestEnvironment(req))
    json(res, 200, { ready: true })
  } catch {
    respondWithError(req, res, new HttpError(503, 'service_not_ready'))
  }
}
