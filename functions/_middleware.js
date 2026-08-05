export async function onRequest(context) {
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
