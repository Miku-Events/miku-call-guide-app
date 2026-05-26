const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'
const DEFAULT_SECRET_KEY = '1x0000000000000000000000000000000AA' // Cloudflare 공식 무조건 성공 테스트 비밀키

/**
 * Cloudflare Turnstile 토큰을 백엔드에서 강력하게 검증합니다.
 * @param {string} token - 클라이언트로부터 전송받은 turnstile 토큰
 * @param {import('node:http').IncomingMessage} req - 요청 객체 (IP 주소 추출용)
 * @returns {Promise<boolean>} 검증 성공 여부
 */
export async function verifyTurnstileToken(token, req) {
  const secretKey = process.env.CLOUDFLARE_TURNSTILE_SECRET_KEY || DEFAULT_SECRET_KEY

  if (!token) {
    console.warn('[Turnstile] Verification failed: Token is missing')
    return false
  }

  const remoteIp = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket?.remoteAddress

  try {
    const response = await fetch(SITEVERIFY_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        secret: secretKey,
        response: token,
        remoteip: remoteIp,
      }),
    })

    if (!response.ok) {
      console.error(`[Turnstile] Cloudflare siteverify HTTP error: ${response.status}`)
      return false
    }

    const data = await response.json()

    if (!data.success) {
      console.warn('[Turnstile] Token validation failed:', data['error-codes'])
      return false
    }

    return true
  } catch (error) {
    console.error('[Turnstile] Verification request crashed:', error)
    return false
  }
}
