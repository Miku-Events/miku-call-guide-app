/* eslint-disable no-control-regex -- These patterns intentionally reject untrusted control characters. */
const SINGLE_LINE_FORBIDDEN_PATTERN = new RegExp(
  '[\\u0000-\\u001f\\u007f-\\u009f\\u061c\\u200e\\u200f\\u2028\\u2029\\u202a-\\u202e\\u2066-\\u2069]',
  'u',
)
const MULTILINE_FORBIDDEN_PATTERN = new RegExp(
  '[\\u0000-\\u0009\\u000b\\u000c\\u000e-\\u001f\\u007f-\\u009f\\u061c\\u200e\\u200f\\u2028\\u2029\\u202a-\\u202e\\u2066-\\u2069]',
  'u',
)
/* eslint-enable no-control-regex */
const GITHUB_LOGIN_PATTERN = /^(?!-)(?!.*--)[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function stringError(name, message) {
  return `${name} ${message}`
}

function primitiveString(value, name, { required = false } = {}) {
  if (value === undefined) {
    return required
      ? { error: stringError(name, 'is required') }
      : { value: undefined }
  }
  if (typeof value !== 'string') {
    return { error: stringError(name, 'must be a string') }
  }
  return { value }
}

/**
 * Normalize an untrusted single-line string without silently coercing values.
 */
export function normalizeSingleLine(value, name, options = {}) {
  const result = primitiveString(value, name, options)
  if (result.error || result.value === undefined) return result

  const nfcValue = result.value.normalize('NFC')
  if (SINGLE_LINE_FORBIDDEN_PATTERN.test(nfcValue)) {
    return { error: stringError(name, 'must be a single line without control characters') }
  }
  const normalized = nfcValue.trim()
  if (options.required && normalized.length === 0) {
    return { error: stringError(name, 'is required') }
  }
  if (options.maxLength && normalized.length > options.maxLength) {
    return { error: stringError(name, `must be ${options.maxLength} characters or less`) }
  }
  if (options.pattern && normalized && !options.pattern.test(normalized)) {
    return { error: stringError(name, options.patternMessage || 'has an invalid format') }
  }
  return { value: normalized || undefined }
}

/**
 * Normalize user prose to LF while rejecting every other control or bidi mark.
 */
export function normalizeMultiline(value, name, options = {}) {
  const result = primitiveString(value, name, options)
  if (result.error || result.value === undefined) return result

  const normalizedLineEndings = result.value
    .replace(/\r\n?/g, '\n')
    .normalize('NFC')
  if (MULTILINE_FORBIDDEN_PATTERN.test(normalizedLineEndings)) {
    return { error: stringError(name, 'contains a forbidden control character') }
  }
  const normalized = normalizedLineEndings.trim()
  if (options.required && normalized.length === 0) {
    return { error: stringError(name, 'is required') }
  }
  if (options.maxLength && normalized.length > options.maxLength) {
    return { error: stringError(name, `must be ${options.maxLength} characters or less`) }
  }
  return { value: normalized || undefined }
}

export function normalizeHttpsUrl(value, name, options = {}) {
  const result = normalizeSingleLine(value, name, options)
  if (result.error || result.value === undefined) return result

  let url
  try {
    url = new URL(result.value)
  } catch {
    return { error: stringError(name, 'must be a valid HTTPS URL') }
  }
  if (url.protocol !== 'https:' || url.username || url.password) {
    return { error: stringError(name, 'must be an HTTPS URL without credentials') }
  }

  const allowedHosts = options.allowedHosts || []
  const hostname = url.hostname.toLowerCase()
  if (
    allowedHosts.length > 0
    && !allowedHosts.some((host) => hostname === host || hostname.endsWith(`.${host}`))
  ) {
    return { error: stringError(name, `must use ${allowedHosts.join(' or ')}`) }
  }
  return { value: url.toString() }
}

export function normalizeGitHubSession(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null

  const id = typeof value.id === 'number'
    ? (Number.isSafeInteger(value.id) && value.id > 0 ? String(value.id) : '')
    : (typeof value.id === 'string' && /^[1-9]\d*$/.test(value.id) ? value.id : '')
  const login = normalizeSingleLine(value.login, 'login', { required: true, maxLength: 39 })
  if (!id || login.error || !login.value || !GITHUB_LOGIN_PATTERN.test(login.value)) {
    return null
  }
  return { ...value, id, login: login.value }
}

export function normalizeIdempotencyKey(value) {
  if (value === null || value === undefined || value === '') return null
  if (typeof value !== 'string') return null
  const normalized = value.trim().toLowerCase()
  return UUID_PATTERN.test(normalized) ? normalized : null
}
