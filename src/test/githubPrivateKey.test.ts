// @vitest-environment node

import { createPrivateKey, webcrypto } from 'node:crypto'
import { beforeAll, describe, expect, it } from 'vitest'
import { importGitHubAppPrivateKey } from '../../api/_github-private-key.js'

let pkcs1PrivateKeyPem = ''
let pkcs8PrivateKeyPem = ''
let publicKey: CryptoKey

function toPkcs8Pem(buffer: ArrayBuffer) {
  const base64 = Buffer.from(buffer).toString('base64').match(/.{1,64}/g)?.join('\n') ?? ''
  return `-----BEGIN PRIVATE KEY-----\n${base64}\n-----END PRIVATE KEY-----\n`
}

beforeAll(async () => {
  const keyPair = await webcrypto.subtle.generateKey({
    hash: 'SHA-256',
    modulusLength: 2048,
    name: 'RSASSA-PKCS1-v1_5',
    publicExponent: new Uint8Array([1, 0, 1]),
  }, true, ['sign', 'verify'])
  publicKey = keyPair.publicKey

  const privateKeyDer = await webcrypto.subtle.exportKey('pkcs8', keyPair.privateKey)
  pkcs8PrivateKeyPem = toPkcs8Pem(privateKeyDer)
  pkcs1PrivateKeyPem = createPrivateKey({
    format: 'der',
    key: Buffer.from(privateKeyDer),
    type: 'pkcs8',
  }).export({
    format: 'pem',
    type: 'pkcs1',
  }).toString()
})

describe('GitHub App private key import', () => {
  it.each([
    ['PKCS#8 with outer whitespace', () => ` \r\n${pkcs8PrivateKeyPem}\t `],
    [
      'GitHub PKCS#1 with literal escaped newlines',
      () => `  ${pkcs1PrivateKeyPem.trim().replace(/\n/g, '\\n')}  `,
    ],
  ])('imports %s and produces a verifiable RS256 signature', async (_label, pem) => {
    const privateKey = await importGitHubAppPrivateKey(pem())
    const payload = new TextEncoder().encode('miku-call-guide-github-app-jwt')
    const signature = await webcrypto.subtle.sign(
      'RSASSA-PKCS1-v1_5',
      privateKey,
      payload,
    )

    await expect(webcrypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      publicKey,
      signature,
      payload,
    )).resolves.toBe(true)
  })
})
