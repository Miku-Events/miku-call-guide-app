export function setCors(req, res) {
  const allowedOrigin = process.env.APP_ORIGIN
  const requestOrigin = req.headers.origin || ''
  if (allowedOrigin && requestOrigin === allowedOrigin) {
    res.setHeader('access-control-allow-origin', allowedOrigin)
    res.setHeader('vary', 'origin')
    res.setHeader('access-control-allow-credentials', 'true')
  }
  res.setHeader('access-control-allow-headers', 'content-type')
  res.setHeader('access-control-allow-methods', 'GET,POST,OPTIONS')
}

export function handleOptions(req, res) {
  setCors(req, res)
  if (req.method === 'OPTIONS') {
    res.status(204).end()
    return true
  }
  return false
}

export function json(res, status, body) {
  res.status(status).json(body)
}

export function requireMethod(req, res, method) {
  if (req.method !== method) {
    res.setHeader('allow', method)
    json(res, 405, { error: 'method_not_allowed' })
    return false
  }
  return true
}

export function readBody(req) {
  if (req.body && typeof req.body === 'object') {
    return req.body
  }

  if (typeof req.body === 'string') {
    return JSON.parse(req.body)
  }

  return {}
}
