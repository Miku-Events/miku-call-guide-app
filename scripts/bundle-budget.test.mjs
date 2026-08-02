import { gzipSync } from 'node:zlib'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_BUNDLE_BUDGET,
  checkBundleBudget,
  collectCallRouteManifestClosure,
  formatBundleBudgetReport,
} from './bundle-budget.mjs'

const temporaryDirectories = []

async function temporaryDist() {
  const directory = await mkdtemp(path.join(tmpdir(), 'miku-bundle-budget-'))
  temporaryDirectories.push(directory)
  return directory
}

async function writeAsset(root, relativePath, contents) {
  const target = path.join(root, ...relativePath.split('/'))
  await mkdir(path.dirname(target), { recursive: true })
  await writeFile(target, contents)
}

async function writeViteManifest(root, manifest) {
  await writeAsset(root, '.vite/manifest.json', `${JSON.stringify(manifest, null, 2)}\n`)
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, {
    force: true,
    recursive: true,
  })))
})

describe('bundle budget', () => {
  it('measures existing budgets and the unique transitive call-route closure', async () => {
    const dist = await temporaryDist()
    const mainJavaScript = 'console.log("main entry")\n'.repeat(80)
    const sharedJavaScript = 'export const shared = true\n'.repeat(60)
    const callJavaScript = 'console.log("call route")\n'.repeat(50)
    const firstCss = '.first { color: #39c5bb; }\n'.repeat(40)
    const secondCss = '.second { display: grid; }\n'.repeat(30)
    await writeAsset(dist, 'index.html', [
      '<!doctype html>',
      '<link rel="stylesheet" href="/assets/first.css">',
      '<script type="module" crossorigin src="/assets/main.js"></script>',
    ].join('\n'))
    await writeAsset(dist, 'assets/main.js', mainJavaScript)
    await writeAsset(dist, 'assets/shared.js', sharedJavaScript)
    await writeAsset(dist, 'assets/call.js', callJavaScript)
    await writeAsset(dist, 'assets/first.css', firstCss)
    await writeAsset(dist, 'assets/nested/second.css', secondCss)
    await writeAsset(dist, 'assets/lazy.js', 'console.log("not the entry")\n'.repeat(200))
    await writeViteManifest(dist, {
      'index.html': {
        file: 'assets/main.js',
        isEntry: true,
        src: 'index.html',
        imports: ['_shared.js'],
        css: ['assets/first.css'],
      },
      '_shared.js': {
        file: 'assets/shared.js',
        css: ['assets/first.css'],
      },
      'src/features/callGuide/CallGuidePage.tsx': {
        file: 'assets/call.js',
        isDynamicEntry: true,
        src: 'src/features/callGuide/CallGuidePage.tsx',
        imports: ['_shared.js'],
        css: ['assets/first.css', 'assets/nested/second.css'],
      },
    })

    const result = await checkBundleBudget({
      distDirectory: dist,
      budget: {
        mainJsGzipBytes: 10_000,
        totalCssGzipBytes: 10_000,
      },
    })

    expect(result.main.path).toBe('assets/main.js')
    expect(result.main.gzipBytes).toBe(gzipSync(mainJavaScript).byteLength)
    expect(result.css.paths).toEqual([
      'assets/first.css',
      'assets/nested/second.css',
    ])
    expect(result.css.gzipBytes).toBe(
      gzipSync(firstCss).byteLength + gzipSync(secondCss).byteLength,
    )
    expect(result.callRoute.js.assets.map(({ path }) => path)).toEqual([
      'assets/call.js',
      'assets/main.js',
      'assets/shared.js',
    ])
    expect(result.callRoute.js.gzipBytes).toBe(
      gzipSync(callJavaScript).byteLength
      + gzipSync(mainJavaScript).byteLength
      + gzipSync(sharedJavaScript).byteLength,
    )
    expect(result.callRoute.css.assets.map(({ path }) => path)).toEqual([
      'assets/first.css',
      'assets/nested/second.css',
    ])
  })

  it('fails with an actionable report when either limit is exceeded', async () => {
    const dist = await temporaryDist()
    await writeAsset(dist, 'index.html', '<script type="module" src="/assets/main.js"></script>')
    await writeAsset(dist, 'assets/main.js', 'const payload = "abcdefghijklmnopqrstuvwxyz";\n'.repeat(40))
    await writeAsset(dist, 'assets/call.js', 'export const call = true\n')
    await writeAsset(dist, 'assets/main.css', '.item { padding: 123456789px; }\n'.repeat(40))
    await writeViteManifest(dist, {
      'index.html': { file: 'assets/main.js', isEntry: true, src: 'index.html' },
      'src/features/callGuide/CallGuidePage.tsx': {
        file: 'assets/call.js',
        isDynamicEntry: true,
        src: 'src/features/callGuide/CallGuidePage.tsx',
      },
    })

    await expect(checkBundleBudget({
      distDirectory: dist,
      budget: {
        mainJsGzipBytes: 1,
        totalCssGzipBytes: 1,
      },
    })).rejects.toThrow(/Bundle budget exceeded.*main JS.*total CSS/s)
  })

  it('rejects missing, ambiguous, and escaping module entry paths', async () => {
    const missing = await temporaryDist()
    await writeAsset(missing, 'index.html', '<main>No scripts</main>')
    await expect(checkBundleBudget({ distDirectory: missing })).rejects.toThrow(/module entry/i)

    const ambiguous = await temporaryDist()
    await writeAsset(ambiguous, 'index.html', [
      '<script type="module" src="/assets/one.js"></script>',
      '<script type="module" src="/assets/two.js"></script>',
    ].join('\n'))
    await expect(checkBundleBudget({ distDirectory: ambiguous })).rejects.toThrow(/exactly one/i)

    const escaping = await temporaryDist()
    await writeAsset(escaping, 'index.html', '<script type="module" src="/%2e%2e%2foutside.js"></script>')
    await expect(checkBundleBudget({ distDirectory: escaping })).rejects.toThrow(/inside dist/i)
  })

  it('keeps the approved baselines at a strict ten-percent ceiling', () => {
    expect(DEFAULT_BUNDLE_BUDGET).toEqual({
      mainJsBaselineBytes: Math.round(101.66 * 1024),
      mainJsGzipBytes: Math.floor(Math.round(101.66 * 1024) * 1.1),
      totalCssBaselineBytes: Math.round(39.09 * 1024),
      totalCssGzipBytes: Math.floor(Math.round(39.09 * 1024) * 1.1),
      callRouteJsGzipBytes: 161_383,
      callRouteCssGzipBytes: 39_312,
    })

    expect(formatBundleBudgetReport({
      main: { path: 'assets/index.js', gzipBytes: 1024 },
      css: { paths: ['assets/index.css'], gzipBytes: 2048 },
      callRoute: {
        js: { assets: [{ path: 'assets/index.js', gzipBytes: 1024 }], gzipBytes: 1024 },
        css: { assets: [{ path: 'assets/index.css', gzipBytes: 2048 }], gzipBytes: 2048 },
      },
      budget: {
        mainJsGzipBytes: 4096,
        totalCssGzipBytes: 4096,
        callRouteJsGzipBytes: 4096,
        callRouteCssGzipBytes: 4096,
      },
    })).toContain('PASS')
  })

  it('rejects missing transitive manifest imports instead of undercounting', () => {
    expect(() => collectCallRouteManifestClosure({
      'index.html': {
        file: 'assets/main.js',
        isEntry: true,
        src: 'index.html',
        imports: ['_missing.js'],
      },
      'src/features/callGuide/CallGuidePage.tsx': {
        file: 'assets/call.js',
        src: 'src/features/callGuide/CallGuidePage.tsx',
      },
    })).toThrow(/missing import/i)
  })
})
