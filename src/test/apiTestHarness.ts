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
