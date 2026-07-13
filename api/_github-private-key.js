const MAX_PRIVATE_KEY_PEM_LENGTH = 64 * 1024
const RSA_ALGORITHM_IDENTIFIER = new Uint8Array([
  0x30, 0x0d,
  0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01,
  0x05, 0x00,
])

function invalidPrivateKey() {
  return new Error('invalid_github_app_private_key')
}

function isPlaceholder(value) {
  const normalized = value.toLowerCase()
  return normalized === 'changeme'
    || normalized === 'change-me'
    || normalized === 'secret'
    || normalized.includes('placeholder')
    || normalized.startsWith('replace-with-')
    || normalized.startsWith('replace_with_')
    || normalized.startsWith('your-')
    || normalized.startsWith('your_')
}

function decodeCanonicalBase64(value) {
  if (
    value.length === 0
    || value.length % 4 !== 0
    || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)
  ) {
    throw invalidPrivateKey()
  }

  let binary
  try {
    binary = atob(value)
  } catch {
    throw invalidPrivateKey()
  }
  if (btoa(binary) !== value) {
    throw invalidPrivateKey()
  }

  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}

function parsePrivateKeyPem(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_PRIVATE_KEY_PEM_LENGTH) {
    throw invalidPrivateKey()
  }

  const normalized = value
    .replace(/\\r\\n/g, '\n')
    .replace(/\\n/g, '\n')
    .replace(/\r\n?/g, '\n')
    .trim()
  if (
    !normalized
    || (!normalized.startsWith('-----BEGIN ') && isPlaceholder(normalized))
  ) {
    throw invalidPrivateKey()
  }

  const match = normalized.match(
    /^-----BEGIN (PRIVATE KEY|RSA PRIVATE KEY)-----\n([A-Za-z0-9+/=]+(?:\n[A-Za-z0-9+/=]+)*)\n-----END \1-----$/,
  )
  if (!match) {
    throw invalidPrivateKey()
  }

  return {
    der: decodeCanonicalBase64(match[2].replace(/\n/g, '')),
    type: match[1] === 'RSA PRIVATE KEY' ? 'pkcs1' : 'pkcs8',
  }
}

function concatenate(...parts) {
  const length = parts.reduce((total, part) => total + part.byteLength, 0)
  const result = new Uint8Array(length)
  let offset = 0
  for (const part of parts) {
    result.set(part, offset)
    offset += part.byteLength
  }
  return result
}

function encodeDerLength(length) {
  if (!Number.isSafeInteger(length) || length < 0) {
    throw invalidPrivateKey()
  }
  if (length < 0x80) {
    return new Uint8Array([length])
  }

  const bytes = []
  let remainder = length
  while (remainder > 0) {
    bytes.unshift(remainder & 0xff)
    remainder = Math.floor(remainder / 0x100)
  }
  if (bytes.length > 4) {
    throw invalidPrivateKey()
  }
  return new Uint8Array([0x80 | bytes.length, ...bytes])
}

function encodeDerElement(tag, value) {
  return concatenate(new Uint8Array([tag]), encodeDerLength(value.byteLength), value)
}

function wrapPkcs1AsPkcs8(pkcs1) {
  const version = new Uint8Array([0x02, 0x01, 0x00])
  const privateKey = encodeDerElement(0x04, pkcs1)
  return encodeDerElement(0x30, concatenate(version, RSA_ALGORITHM_IDENTIFIER, privateKey))
}

export async function importGitHubAppPrivateKey(value) {
  try {
    const parsed = parsePrivateKeyPem(value)
    const pkcs8 = parsed.type === 'pkcs1' ? wrapPkcs1AsPkcs8(parsed.der) : parsed.der
    return await crypto.subtle.importKey(
      'pkcs8',
      pkcs8,
      { hash: 'SHA-256', name: 'RSASSA-PKCS1-v1_5' },
      false,
      ['sign'],
    )
  } catch {
    throw invalidPrivateKey()
  }
}
