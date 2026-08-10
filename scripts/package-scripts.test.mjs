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
    const [manifest, viteConfig] = await Promise.all([
      readJson('package.json'),
      readFile('vite.config.ts', 'utf8'),
    ])

    expect(manifest.scripts['dev:local']).toBe('vite --host 127.0.0.1 --port 4173')
    expect(manifest.scripts['smoke:preview']).toBe('node scripts/preview-browser-smoke.mjs')
    expect(manifest.scripts.build).toBe('tsc -b && vite build')
    expect(manifest.scripts['bundle:check']).toBe(
      'node scripts/check-built-third-party-licenses.mjs && node scripts/bundle-budget.mjs',
    )
    expect(viteConfig).toContain("license: { fileName: 'THIRD_PARTY_LICENSES.md' }")
    expect(viteConfig).toContain("fileName: 'THIRD_PARTY_NOTICES.md'")
    expect(manifest.scripts.check).not.toContain('npm run typecheck')
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

    expect(manifest.allowScripts).toEqual({
      '@astryxdesign/cli@0.2.0': true,
      '@astryxdesign/core@0.2.0': true,
      'esbuild@0.28.1': true,
      'fsevents@2.3.2': false,
      'fsevents@2.3.3': false,
      'workerd@1.20260730.1': true,
    })

    for (const entry of Object.keys(manifest.allowScripts)) {
      const separator = entry.lastIndexOf('@')
      const packageName = entry.slice(0, separator)
      const version = entry.slice(separator + 1)
      const packagePathSuffix = `node_modules/${packageName}`
      expect(Object.entries(lockfile.packages).some(([packagePath, metadata]) => (
        (packagePath === packagePathSuffix || packagePath.endsWith(`/${packagePathSuffix}`))
        && metadata.version === version
      ))).toBe(true)
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
    expect(manifest.scripts.check).toContain('npm run notices:check')
    expect(manifest.scripts['notices:check']).toBe('node scripts/check-third-party-notices.mjs')
  })
})
