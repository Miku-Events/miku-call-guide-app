import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

async function rule() {
  return JSON.parse(await readFile('ops/cloudflare/waf-rate-limit-rule.json', 'utf8'))
}

describe('Cloudflare public-release WAF contract', () => {
  it('uses the single Free-plan IP/path rule for all expensive API boundaries', async () => {
    const value = await rule()

    expect(value).toMatchObject({
      action: 'block',
      enabled: true,
      ratelimit: {
        characteristics: ['cf.colo.id', 'ip.src'],
        mitigation_timeout: 10,
        period: 10,
        requests_per_period: 10,
      },
      ref: 'miku-call-guide-api-burst-v1',
    })
    expect(value).not.toHaveProperty('action_parameters')
    expect(value.expression).toContain('/api/auth/')
    expect(value.expression).toContain('/api/events/')
    expect(value.expression).toContain('/api/ready')
    expect(value.expression).not.toMatch(/http\.host|header|cookie|body/i)
  })
})
