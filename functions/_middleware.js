import { canonicalProductionOrigin } from './_lib/productionHostname.js'

export async function onRequest(context) {
  const requestUrl = new URL(context.request.url)
  if (
    context.env?.APP_ENV === 'production'
    && requestUrl.hostname === 'miku-call-guide-app.pages.dev'
  ) {
    const canonicalOrigin = canonicalProductionOrigin(context.env.APP_ORIGIN)
    if (canonicalOrigin) {
      return new Response(null, {
        headers: {
          'cache-control': 'no-store',
          location: `${canonicalOrigin}${requestUrl.pathname}${requestUrl.search}`,
        },
        status: 308,
      })
    }
  }

  const response = await context.next()
  const contentType = response.headers.get('content-type') ?? ''
  const mediaType = contentType.split(';', 1)[0].trim().toLowerCase()
  if (mediaType !== 'text/html') {
    return response
  }

  const htmlResponse = new Response(response.body, response)
  htmlResponse.headers.set('cache-control', 'no-cache, no-transform')
  return htmlResponse
}
