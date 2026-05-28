// functions/api/_adapter.js
export function cloudflareAdapter(vercelHandler) {
  return async (context) => {
    const { request, env, params } = context
    
    // 🌟 안전장치: Cloudflare Workers 환경에는 글로벌 process 객체가 기본으로 정의되어 있지 않으므로 모킹 주입합니다.
    globalThis.process = globalThis.process || { env: {} }
    globalThis.process.env = globalThis.process.env || {}

    // Cloudflare에 입력된 암호화 환경 변수를 process.env 객체로 호환 바인딩
    for (const [key, value] of Object.entries(env)) {
      process.env[key] = value
    }

    const url = new URL(request.url)
    const reqHeaders = Object.fromEntries(request.headers.entries())
    
    let reqBody = null
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      try {
        reqBody = await request.json()
      } catch {}
    }

    // 2. Vercel Request 모방 객체 생성
    const req = {
      method: request.method,
      url: request.url,
      headers: reqHeaders,
      query: {
        ...Object.fromEntries(url.searchParams.entries()),
        ...params // 동적 파라미터 [eventId] 주입
      },
      body: reqBody,
    }

    let statusCode = 200
    const resHeaders = new Headers()
    let responseBody = null
    let redirectUrl = null

    // 3. Vercel Response 모방 객체 생성
    const res = {
      status(code) {
        statusCode = code
        return this
      },
      setHeader(name, value) {
        resHeaders.set(name, value)
        return this
      },
      json(body) {
        responseBody = JSON.stringify(body)
        resHeaders.set('content-type', 'application/json')
        return this
      },
      redirect(url) {
        redirectUrl = url
        return this
      },
      end() {
        return this
      }
    }

    // 4. 기존 로직 동기식/비동기식 호출 수행
    await vercelHandler(req, res)

    // 5. Cloudflare 표준 Response 객체로 전환 리턴
    if (redirectUrl) {
      resHeaders.set('location', redirectUrl)
      return new Response(null, {
        status: 302,
        headers: resHeaders,
      })
    }
    return new Response(responseBody, {
      status: statusCode,
      headers: resHeaders,
    })
  }
}
