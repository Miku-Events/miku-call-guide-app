import { gzipSync } from 'node:zlib'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_BUNDLE_BUDGET,
  checkBundleBudget,
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

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, {
    force: true,
    recursive: true,
  })))
})

describe('bundle budget', () => {
  it('measures the HTML module entry and sums every emitted CSS asset', async () => {
    const dist = await temporaryDist()
    const mainJavaScript = 'console.log("main entry")\n'.repeat(80)
    const firstCss = '.first { color: #39c5bb; }\n'.repeat(40)
    const secondCss = '.second { display: grid; }\n'.repeat(30)
    await writeAsset(dist, 'index.html', [
      '<!doctype html>',
      '<link rel="stylesheet" href="/assets/first.css">',
      '<script type="module" crossorigin src="/assets/main.js"></script>',
    ].join('\n'))
    await writeAsset(dist, 'assets/main.js', mainJavaScript)
    await writeAsset(dist, 'assets/first.css', firstCss)
    await writeAsset(dist, 'assets/nested/second.css', secondCss)
    await writeAsset(dist, 'assets/lazy.js', 'console.log("not the entry")\n'.repeat(200))

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
  })

  it('fails with an actionable report when either limit is exceeded', async () => {
    const dist = await temporaryDist()
    await writeAsset(dist, 'index.html', '<script type="module" src="/assets/main.js"></script>')
    await writeAsset(dist, 'assets/main.js', 'const payload = "abcdefghijklmnopqrstuvwxyz";\n'.repeat(40))
    await writeAsset(dist, 'assets/main.css', '.item { padding: 123456789px; }\n'.repeat(40))

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
    })

    expect(formatBundleBudgetReport({
      main: { path: 'assets/index.js', gzipBytes: 1024 },
      css: { paths: ['assets/index.css'], gzipBytes: 2048 },
      budget: { mainJsGzipBytes: 4096, totalCssGzipBytes: 4096 },
    })).toContain('PASS')
  })
})
