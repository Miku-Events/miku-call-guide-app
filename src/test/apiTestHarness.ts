export type ApiEnvironment = Record<string, string | undefined>

export type ApiQuery = Record<string, string | string[] | undefined>

export interface TestRequest {
  method: string
  url: string
  headers: Record<string, string>
  query: ApiQuery
  body?: unknown
  env?: ApiEnvironment
}

type HeaderValue = string | number | readonly string[]

function toHeaderValues(value: HeaderValue): string[] {
  return Array.isArray(value)
    ? value.map(String)
    : [String(value)]
}

export class TestResponse {
  statusCode = 200
  body: unknown = null
  redirectUrl: string | null = null

  private readonly headerValues = new Map<string, string[]>()

  status(code: number): this {
    this.statusCode = code
    return this
  }

  setHeader(name: string, value: HeaderValue): this {
    this.headerValues.set(name.toLowerCase(), toHeaderValues(value))
    return this
  }

  appendHeader(name: string, value: HeaderValue): this {
    const key = name.toLowerCase()
    const current = this.headerValues.get(key) ?? []
    this.headerValues.set(key, [...current, ...toHeaderValues(value)])
    return this
  }

  getHeader(name: string): string | string[] | undefined {
    const values = this.headerValues.get(name.toLowerCase())
    if (!values) {
      return undefined
    }
    return values.length === 1 ? values[0] : [...values]
  }

  getHeaderValues(name: string): string[] {
    return [...(this.headerValues.get(name.toLowerCase()) ?? [])]
  }

  json(body: unknown): this {
    this.body = body
    this.setHeader('content-type', 'application/json')
    return this
  }

  redirect(url: string): this {
    this.statusCode = 302
    this.redirectUrl = url
    this.setHeader('location', url)
    return this
  }

  end(): this {
    return this
  }
}

function requestUrl(request: TestRequest): string {
  const url = new URL(request.url)
  for (const [name, value] of Object.entries(request.query)) {
    for (const item of Array.isArray(value) ? value : [value]) {
      if (item !== undefined) url.searchParams.append(name, item)
    }
  }
  return url.toString()
}

export type PagesHandler = (context: {
  env: ApiEnvironment
  params: Record<string, string>
  request: Request
}) => Promise<Response> | Response

export function createWebRequest(request: TestRequest): Request {
  const headers = new Headers(request.headers)
  let body: BodyInit | undefined
  if (request.body !== undefined) {
    body = typeof request.body === 'string' ? request.body : JSON.stringify(request.body)
    if (!headers.has('content-type')) headers.set('content-type', 'application/json')
  }
  return new Request(requestUrl(request), { method: request.method, headers, body })
}

export function asLegacyHandler(
  onRequest: PagesHandler,
  params: Record<string, string> = {},
) {
  return async (request: TestRequest, response: TestResponse) => {
    const webRequest = createWebRequest(request)
    const queryParams = Object.fromEntries(
      Object.entries(request.query).flatMap(([name, value]) => (
        typeof value === 'string' ? [[name, value]] : []
      )),
    )
    const webResponse = await onRequest({
      env: request.env ?? {},
      params: { ...queryParams, ...params },
      request: webRequest,
    })
    response.statusCode = webResponse.status
    for (const [name, value] of webResponse.headers) response.appendHeader(name, value)
    const getSetCookie = (webResponse.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie
    if (getSetCookie) {
      response.setHeader('set-cookie', getSetCookie.call(webResponse.headers))
    }
    response.redirectUrl = webResponse.headers.get('location')
    const text = await webResponse.text()
    response.body = webResponse.headers.get('content-type')?.startsWith('application/json') && text
      ? JSON.parse(text)
      : text || null
    return response
  }
}

export function createRequest(overrides: Partial<TestRequest> = {}): TestRequest {
  return {
    method: 'GET',
    url: 'https://app.example.test/api/test',
    headers: {},
    query: {},
    ...overrides,
  }
}

export function createResponse(): TestResponse {
  return new TestResponse()
}

export function getSetCookies(response: TestResponse): string[] {
  return response.getHeaderValues('set-cookie')
}
