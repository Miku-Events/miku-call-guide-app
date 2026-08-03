import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import ciConfig from '../playwright.ci.config'

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'))
}

describe('local and release scripts', () => {
  it('keeps the documented Node and npm toolchain aligned', async () => {
    const [manifest, nodeVersion, readme, agentInstructions] = await Promise.all([
      readJson('package.json'),
      readFile('.node-version', 'utf8'),
      readFile('README.md', 'utf8'),
      readFile('AGENTS.md', 'utf8'),
    ])

    expect(nodeVersion.trim()).toBe('26.5.1')
    expect(manifest.packageManager).toBe('npm@11.17.0')
    expect(manifest.engines).toEqual({
      node: '>=24.18.1 <27',
      npm: '>=11.17.0 <12',
    })
    expect(readme).toContain('Node.js 26.5.1')
    expect(readme).toContain('npm 11.17.0')
    expect(agentInstructions).toContain('.node-version` (26.5.1)')
    expect(agentInstructions).toContain('npm 11.17.0')
  })

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
    expect(lockfile.packages[''].dependencies).toEqual(manifest.dependencies)
    expect(lockfile.packages[''].devDependencies).toEqual(manifest.devDependencies)
    expect(lockfile.packages[''].engines).toEqual(manifest.engines)
  })

  it('keeps TypeScript 6 in place while aligning Node declarations with Node 26', async () => {
    const [manifest, lockfile] = await Promise.all([
      readJson('package.json'),
      readJson('package-lock.json'),
    ])

    expect(manifest.devDependencies.typescript).toBe('~6.0.2')
    expect(lockfile.packages['node_modules/typescript'].version).toBe('6.0.3')
    expect(manifest.devDependencies['typescript-eslint']).toBe('^8.65.0')
    expect(lockfile.packages['node_modules/typescript-eslint'].version).toBe('8.65.0')
    expect(manifest.devDependencies['@types/node']).toBe('^26.1.2')
  })

  it('reviews every install script used by the locked dependency graph', async () => {
    const [manifest, lockfile] = await Promise.all([
      readJson('package.json'),
      readJson('package-lock.json'),
    ])

    const reviewedInstallScripts = Object.fromEntries(
      Object.keys(manifest.allowScripts).map((entry) => {
        const separator = entry.lastIndexOf('@')
        return [entry.slice(0, separator), entry.slice(separator + 1)]
      }),
    )

    expect(reviewedInstallScripts).toEqual({
      '@astryxdesign/cli': '0.2.0',
      '@astryxdesign/core': '0.2.0',
      esbuild: '0.28.1',
      workerd: '1.20260730.1',
    })

    for (const [packageName, version] of Object.entries(reviewedInstallScripts)) {
      expect(manifest.allowScripts[`${packageName}@${version}`]).toBe(true)
      expect(lockfile.packages[`node_modules/${packageName}`].version).toBe(version)
    }
  })

  it('starts only the reserved-port-safe preview server for CI E2E', () => {
    expect(ciConfig.failOnFlakyTests).toBe(true)
    expect(ciConfig.retries).toBe(1)
    expect(ciConfig.workers).toBe(1)
    expect(ciConfig.reporter).toEqual([
      ['dot'],
      ['html', { open: 'never' }],
    ])
    expect(Array.isArray(ciConfig.webServer)).toBe(false)
    expect(ciConfig.webServer).toMatchObject({
      command: 'npm run preview -- --host 127.0.0.1 --port 4173 --strictPort',
      url: 'http://127.0.0.1:4173',
      reuseExistingServer: false,
    })
    expect(ciConfig.use?.baseURL).toBe('http://127.0.0.1:4173')
    expect(ciConfig.use?.screenshot).toBe('only-on-failure')
    expect(ciConfig.use?.trace).toBe('retain-on-failure')
  })

  it('guards behavioral E2E sources without a repeated stability command', async () => {
    const manifest = await readJson('package.json')

    expect(manifest.scripts['test:e2e:guard']).toBe('node scripts/check-e2e-source.mjs')
    expect(manifest.scripts['test:e2e:stability']).toBeUndefined()
    expect(manifest.scripts.check).toContain('npm run test:e2e:guard')
  })
})
