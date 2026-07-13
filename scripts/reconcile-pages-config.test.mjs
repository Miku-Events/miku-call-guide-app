import { describe, expect, it, vi } from 'vitest'
import { removeLegacyDashboardAppOrigin } from './reconcile-pages-config.mjs'

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json' },
    status,
  })
}

describe('Cloudflare Pages configuration reconciliation', () => {
  it('does nothing when production has no legacy APP_ORIGIN binding', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({
      result: {
        deployment_configs: {
          production: { env_vars: {} },
        },
      },
      success: true,
    }))

    await expect(removeLegacyDashboardAppOrigin({
      accountId: 'account-id',
      apiToken: 'api-token',
      fetchImpl,
    })).resolves.toEqual({ changed: false })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('deletes only the legacy production APP_ORIGIN dashboard binding', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        result: {
          deployment_configs: {
            production: {
              env_vars: {
                APP_ORIGIN: { type: 'secret_text', value: '' },
                SESSION_SECRET: { type: 'secret_text', value: '' },
              },
            },
          },
        },
        success: true,
      }))
      .mockResolvedValueOnce(jsonResponse({ result: {}, success: true }))
      .mockResolvedValueOnce(jsonResponse({
        result: {
          deployment_configs: {
            production: {
              env_vars: {
                SESSION_SECRET: { type: 'secret_text', value: '' },
              },
            },
          },
        },
        success: true,
      }))

    await expect(removeLegacyDashboardAppOrigin({
      accountId: 'account-id',
      apiToken: 'api-token',
      fetchImpl,
    })).resolves.toEqual({ changed: true })

    expect(fetchImpl).toHaveBeenCalledTimes(3)
    const [url, options] = fetchImpl.mock.calls[1]
    expect(url).toBe(
      'https://api.cloudflare.com/client/v4/accounts/account-id/pages/projects/miku-call-guide-app',
    )
    expect(options).toMatchObject({
      method: 'PATCH',
      headers: {
        authorization: 'Bearer api-token',
        'content-type': 'application/json',
      },
    })
    expect(JSON.parse(options.body)).toEqual({
      deployment_configs: {
        production: {
          env_vars: { APP_ORIGIN: null },
        },
      },
    })
  })

  it('preserves the canonical plain-text APP_ORIGIN binding', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({
      result: {
        deployment_configs: {
          production: {
            env_vars: {
              APP_ORIGIN: {
                type: 'plain_text',
                value: 'https://miku-call-guide-app.pages.dev',
              },
            },
          },
        },
      },
      success: true,
    }))

    await expect(removeLegacyDashboardAppOrigin({
      accountId: 'account-id',
      apiToken: 'api-token',
      fetchImpl,
    })).resolves.toEqual({ changed: false })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('removes the known stale plain-text APP_ORIGIN binding', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        result: {
          deployment_configs: {
            production: {
              env_vars: {
                APP_ORIGIN: {
                  type: 'plain_text',
                  value: 'https://miku.sekai.today',
                },
              },
            },
          },
        },
        success: true,
      }))
      .mockResolvedValueOnce(jsonResponse({ result: {}, success: true }))
      .mockResolvedValueOnce(jsonResponse({
        result: {
          deployment_configs: { production: { env_vars: {} } },
        },
        success: true,
      }))

    await expect(removeLegacyDashboardAppOrigin({
      accountId: 'account-id',
      apiToken: 'api-token',
      fetchImpl,
    })).resolves.toEqual({ changed: true })
  })

  it('fails closed for an unexpected plain-text APP_ORIGIN binding', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({
      result: {
        deployment_configs: {
          production: {
            env_vars: {
              APP_ORIGIN: {
                type: 'plain_text',
                value: 'https://unexpected.example',
              },
            },
          },
        },
      },
      success: true,
    }))

    await expect(removeLegacyDashboardAppOrigin({
      accountId: 'account-id',
      apiToken: 'api-token',
      fetchImpl,
    })).rejects.toThrow('not a recognized legacy binding')
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('fails when the deleted binding is still present after reconciliation', async () => {
    const legacyProject = {
      result: {
        deployment_configs: {
          production: {
            env_vars: {
              APP_ORIGIN: { type: 'secret_text', value: '' },
            },
          },
        },
      },
      success: true,
    }
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse(legacyProject))
      .mockResolvedValueOnce(jsonResponse({ result: {}, success: true }))
      .mockResolvedValueOnce(jsonResponse(legacyProject))

    await expect(removeLegacyDashboardAppOrigin({
      accountId: 'account-id',
      apiToken: 'api-token',
      fetchImpl,
    })).rejects.toThrow('legacy APP_ORIGIN binding is still present')
  })

  it('requires credentials before making a request', async () => {
    const fetchImpl = vi.fn()

    await expect(removeLegacyDashboardAppOrigin({
      accountId: '',
      apiToken: '',
      fetchImpl,
    })).rejects.toThrow('Cloudflare Pages credentials are required')
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('does not include an upstream response body in failures', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(
      'sensitive-upstream-detail',
      { status: 403 },
    ))

    await expect(removeLegacyDashboardAppOrigin({
      accountId: 'account-id',
      apiToken: 'api-token',
      fetchImpl,
    })).rejects.not.toThrow('sensitive-upstream-detail')
  })
})
