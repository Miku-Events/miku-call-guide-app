import { gzipSync } from 'node:zlib'
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const KIB = 1024
const MAIN_JS_BASELINE_BYTES = Math.round(101.66 * KIB)
const TOTAL_CSS_BASELINE_BYTES = Math.round(39.09 * KIB)

export const DEFAULT_BUNDLE_BUDGET = Object.freeze({
  mainJsBaselineBytes: MAIN_JS_BASELINE_BYTES,
  mainJsGzipBytes: Math.floor(MAIN_JS_BASELINE_BYTES * 1.1),
  totalCssBaselineBytes: TOTAL_CSS_BASELINE_BYTES,
  totalCssGzipBytes: Math.floor(TOTAL_CSS_BASELINE_BYTES * 1.1),
})

function extractAttribute(tag, name) {
  const expression = new RegExp(
    `(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`,
    'i',
  )
  const match = tag.match(expression)
  return match ? (match[1] ?? match[2] ?? match[3] ?? '') : ''
}

function findModuleEntry(html) {
  const entries = [...html.matchAll(/<script\b[^>]*>/gi)]
    .filter(([tag]) => extractAttribute(tag, 'type').toLowerCase() === 'module')
    .map(([tag]) => extractAttribute(tag, 'src'))
    .filter(Boolean)

  if (entries.length !== 1) {
    throw new Error(`dist/index.html must contain exactly one module entry script; found ${entries.length}`)
  }
  return entries[0]
}

function resolveDistAsset(distDirectory, source) {
  const baseUrl = new URL('https://bundle.invalid/')
  const assetUrl = new URL(source, baseUrl)
  if (assetUrl.origin !== baseUrl.origin) {
    throw new Error('The module entry must be a local asset inside dist')
  }

  let decodedPath
  try {
    decodedPath = decodeURIComponent(assetUrl.pathname)
  } catch {
    throw new Error('The module entry contains an invalid URL-encoded path')
  }
  const target = path.resolve(distDirectory, `.${decodedPath}`)
  const relativePath = path.relative(distDirectory, target)
  if (relativePath === '' || relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    throw new Error('The module entry must resolve to a file inside dist')
  }
  if (path.extname(target).toLowerCase() !== '.js') {
    throw new Error('The module entry must resolve to a JavaScript asset inside dist')
  }
  return {
    relativePath: relativePath.split(path.sep).join('/'),
    target,
  }
}

async function findCssAssets(directory, root = directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const paths = []
  for (const entry of entries) {
    const target = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      paths.push(...await findCssAssets(target, root))
    } else if (entry.isFile() && path.extname(entry.name).toLowerCase() === '.css') {
      paths.push({
        relativePath: path.relative(root, target).split(path.sep).join('/'),
        target,
      })
    }
  }
  return paths.sort((left, right) => left.relativePath.localeCompare(right.relativePath))
}

function gzipBytes(contents) {
  return gzipSync(contents).byteLength
}

function normalizeBudget(budget = DEFAULT_BUNDLE_BUDGET) {
  const mainJsGzipBytes = budget.mainJsGzipBytes
  const totalCssGzipBytes = budget.totalCssGzipBytes
  if (!Number.isSafeInteger(mainJsGzipBytes) || mainJsGzipBytes < 0) {
    throw new Error('mainJsGzipBytes must be a non-negative integer')
  }
  if (!Number.isSafeInteger(totalCssGzipBytes) || totalCssGzipBytes < 0) {
    throw new Error('totalCssGzipBytes must be a non-negative integer')
  }
  return { mainJsGzipBytes, totalCssGzipBytes }
}

function formatSize(bytes) {
  return `${(bytes / KIB).toFixed(2)} KiB gzip (${bytes} bytes)`
}

export function formatBundleBudgetReport(result) {
  const mainPassed = result.main.gzipBytes <= result.budget.mainJsGzipBytes
  const cssPassed = result.css.gzipBytes <= result.budget.totalCssGzipBytes
  const status = mainPassed && cssPassed ? 'PASS' : 'FAIL'
  return [
    `Bundle budget: ${status}`,
    `- main JS (${result.main.path}): ${formatSize(result.main.gzipBytes)} / ${formatSize(result.budget.mainJsGzipBytes)} ${mainPassed ? 'PASS' : 'FAIL'}`,
    `- total CSS (${result.css.paths.length} files): ${formatSize(result.css.gzipBytes)} / ${formatSize(result.budget.totalCssGzipBytes)} ${cssPassed ? 'PASS' : 'FAIL'}`,
  ].join('\n')
}

export async function checkBundleBudget({
  distDirectory = path.resolve('dist'),
  budget = DEFAULT_BUNDLE_BUDGET,
} = {}) {
  const normalizedDist = path.resolve(distDirectory)
  const html = await readFile(path.join(normalizedDist, 'index.html'), 'utf8')
  const mainAsset = resolveDistAsset(normalizedDist, findModuleEntry(html))
  const cssAssets = await findCssAssets(normalizedDist)
  const normalizedBudget = normalizeBudget(budget)
  const result = {
    main: {
      path: mainAsset.relativePath,
      gzipBytes: gzipBytes(await readFile(mainAsset.target)),
    },
    css: {
      paths: cssAssets.map(({ relativePath }) => relativePath),
      gzipBytes: (await Promise.all(cssAssets.map(async ({ target }) => (
        gzipBytes(await readFile(target))
      )))).reduce((total, bytes) => total + bytes, 0),
    },
    budget: normalizedBudget,
  }

  const report = formatBundleBudgetReport(result)
  if (
    result.main.gzipBytes > normalizedBudget.mainJsGzipBytes
    || result.css.gzipBytes > normalizedBudget.totalCssGzipBytes
  ) {
    throw new Error(`Bundle budget exceeded.\n${report}`)
  }
  return result
}

async function runCli() {
  const distFlag = process.argv.indexOf('--dist')
  const distDirectory = distFlag >= 0 ? process.argv[distFlag + 1] : undefined
  if (distFlag >= 0 && !distDirectory) {
    throw new Error('--dist requires a directory')
  }
  const result = await checkBundleBudget({ distDirectory })
  process.stdout.write(`${formatBundleBudgetReport(result)}\n`)
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : ''
if (invokedPath === import.meta.url) {
  runCli().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}
