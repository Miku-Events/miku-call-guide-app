import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { test } from 'vitest'

const appOriginToken = '%VITE_APP_ORIGIN%'

test('index metadata uses the configured absolute app origin', async () => {
  const html = await readFile(path.resolve(process.cwd(), 'index.html'), 'utf8')

  assert.match(html, new RegExp(`<link rel="canonical" href="${appOriginToken}/"`))
  assert.match(html, new RegExp(`<meta property="og:url" content="${appOriginToken}/"`))
  assert.match(html, new RegExp(`<meta property="og:image" content="${appOriginToken}/og-image.png"`))
  assert.match(html, new RegExp(`<meta property="twitter:image" content="${appOriginToken}/og-image.png"`))
})

test('the Open Graph image is a real 1200 by 630 PNG', async () => {
  const image = await readFile(path.resolve(process.cwd(), 'public/og-image.png'))
  const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])

  assert.deepEqual(image.subarray(0, 8), pngSignature)
  assert.equal(image.readUInt32BE(16), 1200)
  assert.equal(image.readUInt32BE(20), 630)
  assert.ok(image.length > 10_000, 'OG image must not be an empty placeholder')
})
