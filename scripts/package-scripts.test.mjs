import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import ciConfig from '../playwright.ci.config'

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'))
}

describe('local and release scripts', () => {
  it('provides the reserved-port-safe local dev command and preview browser smoke', async () => {
    const manifest = await readJson('package.json')

    expect(manifest.scripts['dev:local']).toBe('vite --host 127.0.0.1 --port 4173')
    expect(manifest.scripts['smoke:preview']).toBe('node scripts/preview-browser-smoke.mjs')
  })

  it('keeps the lockfile root metadata aligned with package.json', async () => {
    const [manifest, lockfile] = await Promise.all([
      readJson('package.json'),
      readJson('package-lock.json'),
    ])

    expect(lockfile.packages[''].name).toBe(manifest.name)
    expect(lockfile.packages[''].version).toBe(manifest.version)
    expect(lockfile.packages[''].engines).toEqual(manifest.engines)
  })

  it('starts only the reserved-port-safe preview server for CI E2E', () => {
    expect(Array.isArray(ciConfig.webServer)).toBe(false)
    expect(ciConfig.webServer).toMatchObject({
      command: 'npm run preview -- --host 127.0.0.1 --port 4173 --strictPort',
      url: 'http://127.0.0.1:4173',
      reuseExistingServer: false,
    })
    expect(ciConfig.use?.baseURL).toBe('http://127.0.0.1:4173')
  })
})
