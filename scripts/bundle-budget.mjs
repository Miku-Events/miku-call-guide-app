import { gzipSync } from 'node:zlib'
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const KIB = 1024
const MAIN_JS_BASELINE_BYTES = Math.round(101.66 * KIB)
const TOTAL_CSS_BASELINE_BYTES = Math.round(39.09 * KIB)
const CALL_ROUTE_JS_GZIP_BYTES = 161_383
const CALL_ROUTE_CSS_GZIP_BYTES = 39_312
const VITE_MANIFEST_PATH = '.vite/manifest.json'
const CALL_GUIDE_ENTRY_SOURCE = 'src/features/callGuide/CallGuidePage.tsx'

export const DEFAULT_BUNDLE_BUDGET = Object.freeze({
  mainJsBaselineBytes: MAIN_JS_BASELINE_BYTES,
  mainJsGzipBytes: Math.floor(MAIN_JS_BASELINE_BYTES * 1.1),
  totalCssBaselineBytes: TOTAL_CSS_BASELINE_BYTES,
  totalCssGzipBytes: Math.floor(TOTAL_CSS_BASELINE_BYTES * 1.1),
  callRouteJsGzipBytes: CALL_ROUTE_JS_GZIP_BYTES,
  callRouteCssGzipBytes: CALL_ROUTE_CSS_GZIP_BYTES,
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

function resolveDistAsset(distDirectory, source, expectedExtension) {
  const baseUrl = new URL('https://bundle.invalid/')
  const assetUrl = new URL(source, baseUrl)
  if (assetUrl.origin !== baseUrl.origin) {
    throw new Error('Bundle assets must be local files inside dist')
  }

  let decodedPath
  try {
    decodedPath = decodeURIComponent(assetUrl.pathname)
  } catch {
    throw new Error('A bundle asset contains an invalid URL-encoded path')
  }
  const target = path.resolve(distDirectory, `.${decodedPath}`)
  const relativePath = path.relative(distDirectory, target)
  if (relativePath === '' || relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    throw new Error('A bundle asset must resolve to a file inside dist')
  }
  if (path.extname(target).toLowerCase() !== expectedExtension) {
    throw new Error(`A bundle asset must resolve to a ${expectedExtension} file inside dist`)
  }
  return {
    relativePath: relativePath.split(path.sep).join('/'),
    target,
  }
}

function resolveManifestAsset(distDirectory, source, expectedExtension) {
  if (typeof source !== 'string' || source === '') {
    throw new Error('Vite manifest contains an invalid asset path')
  }
  return resolveDistAsset(distDirectory, `/${source.replace(/^\/+/, '')}`, expectedExtension)
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
  const normalized = {
    mainJsGzipBytes: budget.mainJsGzipBytes,
    totalCssGzipBytes: budget.totalCssGzipBytes,
    callRouteJsGzipBytes: budget.callRouteJsGzipBytes ?? DEFAULT_BUNDLE_BUDGET.callRouteJsGzipBytes,
    callRouteCssGzipBytes: budget.callRouteCssGzipBytes ?? DEFAULT_BUNDLE_BUDGET.callRouteCssGzipBytes,
  }
  for (const [name, value] of Object.entries(normalized)) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error(`${name} must be a non-negative integer`)
    }
  }
  return normalized
}

function formatSize(bytes) {
  return `${(bytes / KIB).toFixed(2)} KiB gzip (${bytes} bytes)`
}

function normalizeSource(source) {
  return source.replaceAll('\\', '/')
}

function validateManifestEntry(key, value) {
  if (!value || typeof value !== 'object' || typeof value.file !== 'string') {
    throw new Error(`Vite manifest entry ${key} is invalid`)
  }
  for (const field of ['imports', 'css']) {
    if (value[field] !== undefined && (
      !Array.isArray(value[field])
      || value[field].some((item) => typeof item !== 'string')
    )) {
      throw new Error(`Vite manifest entry ${key} has an invalid ${field} list`)
    }
  }
}

/** Returns the unique static-import closure for the main and call-guide entries. */
export function collectCallRouteManifestClosure(manifest) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw new Error('Vite manifest must be an object')
  }
  const entries = Object.entries(manifest)
  for (const [key, value] of entries) {
    validateManifestEntry(key, value)
  }

  const mainEntry = entries.find(([key, value]) => (
    key === 'index.html' || (value.isEntry === true && normalizeSource(value.src ?? '') === 'index.html')
  ))
  if (!mainEntry) {
    throw new Error('Vite manifest does not contain the index.html entry')
  }
  const callEntry = entries.find(([key, value]) => (
    normalizeSource(key) === CALL_GUIDE_ENTRY_SOURCE
    || normalizeSource(value.src ?? '') === CALL_GUIDE_ENTRY_SOURCE
  ))
  if (!callEntry) {
    throw new Error(`Vite manifest does not contain ${CALL_GUIDE_ENTRY_SOURCE}`)
  }

  const visited = new Set()
  const visit = (key) => {
    if (visited.has(key)) {
      return
    }
    const entry = manifest[key]
    if (!entry) {
      throw new Error(`Vite manifest references missing import ${key}`)
    }
    validateManifestEntry(key, entry)
    visited.add(key)
    for (const imported of entry.imports ?? []) {
      visit(imported)
    }
  }
  visit(mainEntry[0])
  visit(callEntry[0])
  return {
    callEntryKey: callEntry[0],
    entryKeys: [...visited],
    mainEntryKey: mainEntry[0],
  }
}

async function measureAssets(distDirectory, assets) {
  return Promise.all([...assets]
    .sort((left, right) => left.localeCompare(right))
    .map(async (source) => {
      const extension = path.extname(source).toLowerCase()
      const asset = resolveManifestAsset(distDirectory, source, extension)
      return {
        path: asset.relativePath,
        gzipBytes: gzipBytes(await readFile(asset.target)),
      }
    }))
}

async function measureCallRoute(distDirectory, manifest) {
  const closure = collectCallRouteManifestClosure(manifest)
  const js = new Set()
  const css = new Set()
  for (const key of closure.entryKeys) {
    const entry = manifest[key]
    if (path.posix.extname(normalizeSource(entry.file)).toLowerCase() !== '.js') {
      throw new Error(`Vite manifest entry ${key} does not emit a JavaScript file`)
    }
    js.add(entry.file)
    for (const cssFile of entry.css ?? []) {
      if (path.posix.extname(normalizeSource(cssFile)).toLowerCase() !== '.css') {
        throw new Error(`Vite manifest entry ${key} contains a non-CSS stylesheet asset`)
      }
      css.add(cssFile)
    }
  }
  const jsAssets = await measureAssets(distDirectory, js)
  const cssAssets = await measureAssets(distDirectory, css)
  return {
    ...closure,
    js: {
      assets: jsAssets,
      gzipBytes: jsAssets.reduce((total, asset) => total + asset.gzipBytes, 0),
    },
    css: {
      assets: cssAssets,
      gzipBytes: cssAssets.reduce((total, asset) => total + asset.gzipBytes, 0),
    },
  }
}

function assetReport(label, measurement) {
  return [
    `  ${label}:`,
    ...measurement.assets.map((asset) => `    - ${asset.path}: ${formatSize(asset.gzipBytes)}`),
  ]
}

export function formatBundleBudgetReport(result) {
  const mainPassed = result.main.gzipBytes <= result.budget.mainJsGzipBytes
  const cssPassed = result.css.gzipBytes <= result.budget.totalCssGzipBytes
  const routeJsPassed = result.callRoute.js.gzipBytes <= result.budget.callRouteJsGzipBytes
  const routeCssPassed = result.callRoute.css.gzipBytes <= result.budget.callRouteCssGzipBytes
  const status = mainPassed && cssPassed && routeJsPassed && routeCssPassed ? 'PASS' : 'FAIL'
  return [
    `Bundle budget: ${status}`,
    `- main JS (${result.main.path}): ${formatSize(result.main.gzipBytes)} / ${formatSize(result.budget.mainJsGzipBytes)} ${mainPassed ? 'PASS' : 'FAIL'}`,
    `- total CSS (${result.css.paths.length} files): ${formatSize(result.css.gzipBytes)} / ${formatSize(result.budget.totalCssGzipBytes)} ${cssPassed ? 'PASS' : 'FAIL'}`,
    `- cold call-route JS (${result.callRoute.js.assets.length} unique assets): ${formatSize(result.callRoute.js.gzipBytes)} / ${formatSize(result.budget.callRouteJsGzipBytes)} ${routeJsPassed ? 'PASS' : 'FAIL'}`,
    ...assetReport('JS assets', result.callRoute.js),
    `- cold call-route CSS (${result.callRoute.css.assets.length} unique assets): ${formatSize(result.callRoute.css.gzipBytes)} / ${formatSize(result.budget.callRouteCssGzipBytes)} ${routeCssPassed ? 'PASS' : 'FAIL'}`,
    ...assetReport('CSS assets', result.callRoute.css),
  ].join('\n')
}

export async function checkBundleBudget({
  distDirectory = path.resolve('dist'),
  budget = DEFAULT_BUNDLE_BUDGET,
} = {}) {
  const normalizedDist = path.resolve(distDirectory)
  const html = await readFile(path.join(normalizedDist, 'index.html'), 'utf8')
  const mainAsset = resolveDistAsset(normalizedDist, findModuleEntry(html), '.js')
  const cssAssets = await findCssAssets(normalizedDist)
  const manifest = JSON.parse(await readFile(path.join(normalizedDist, VITE_MANIFEST_PATH), 'utf8'))
  const normalizedBudget = normalizeBudget(budget)
  const callRoute = await measureCallRoute(normalizedDist, manifest)
  if (normalizeSource(manifest[callRoute.mainEntryKey].file) !== mainAsset.relativePath) {
    throw new Error('Vite manifest main entry does not match the index.html module script')
  }
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
    callRoute,
    budget: normalizedBudget,
  }

  const report = formatBundleBudgetReport(result)
  if (
    result.main.gzipBytes > normalizedBudget.mainJsGzipBytes
    || result.css.gzipBytes > normalizedBudget.totalCssGzipBytes
    || result.callRoute.js.gzipBytes > normalizedBudget.callRouteJsGzipBytes
    || result.callRoute.css.gzipBytes > normalizedBudget.callRouteCssGzipBytes
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
