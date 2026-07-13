import { createHash } from 'node:crypto'
import { readFile, readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  defaultContractDestination,
  defaultContractLock,
  expectedContractSourceRepository,
  resolveContractSourceIdentity,
} from './sync-data-contracts.mjs'

const sha256Pattern = /^[a-f0-9]{64}$/
const fullCommitPattern = /^[a-f0-9]{40}$/

function hash(contents) {
  return createHash('sha256').update(contents).digest('hex')
}

function isPlainObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function assertSafeFileName(file, label) {
  if (typeof file !== 'string' || file.length === 0 || path.basename(file) !== file || file === '.' || file === '..') {
    throw new Error(`${label} contains an unsafe file name.`)
  }
}

async function readJson(file, label) {
  let value
  try {
    value = JSON.parse(await readFile(file, 'utf8'))
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (!isPlainObject(value)) {
    throw new Error(`${label} must contain a JSON object.`)
  }
  return value
}

function validateLock(lock) {
  if (
    Object.keys(lock).sort().join(',') !== 'files,schemaVersion,source'
    || lock.schemaVersion !== 1
    || !Array.isArray(lock.files)
    || lock.files.length === 0
  ) {
    throw new Error('Contract hash lock must use schemaVersion 1 and contain files.')
  }
  if (
    !isPlainObject(lock.source)
    || Object.keys(lock.source).sort().join(',') !== 'commit,repository'
    || lock.source.repository !== expectedContractSourceRepository
  ) {
    throw new Error(`Contract hash lock source repository must be ${expectedContractSourceRepository}.`)
  }
  if (!fullCommitPattern.test(lock.source.commit)) {
    throw new Error('Contract hash lock source commit must be a full lowercase 40-character SHA.')
  }
  const seen = new Set()
  for (const entry of lock.files) {
    if (!isPlainObject(entry) || Object.keys(entry).sort().join(',') !== 'file,sha256') {
      throw new Error('Contract hash lock contains an invalid file entry.')
    }
    assertSafeFileName(entry.file, 'Contract hash lock')
    if (!sha256Pattern.test(entry.sha256)) {
      throw new Error(`Contract hash lock has an invalid sha256 for ${entry.file}.`)
    }
    if (seen.has(entry.file)) {
      throw new Error(`Contract hash lock contains duplicate file ${entry.file}.`)
    }
    seen.add(entry.file)
  }
}

function validateContractManifest(manifest) {
  if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.schemas) || manifest.schemas.length === 0) {
    throw new Error('Contract manifest must use schemaVersion 1 and contain schemas.')
  }
  const seen = new Set()
  for (const entry of manifest.schemas) {
    const safeSchemaPath = isPlainObject(entry)
      && typeof entry.file === 'string'
      && /^schemas\/[A-Za-z0-9._-]+\.schema\.json$/.test(entry.file)
    if (!safeSchemaPath || !sha256Pattern.test(entry.sha256)) {
      throw new Error('Contract manifest contains an invalid schema path or sha256.')
    }
    if (seen.has(entry.file)) {
      throw new Error(`Contract manifest contains duplicate schema ${entry.file}.`)
    }
    seen.add(entry.file)
  }
}

async function regularFileNames(directory, label) {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => null)
  if (!entries) {
    throw new Error(`${label} does not exist: ${directory}`)
  }
  const unsupported = entries.filter((entry) => !entry.isFile()).map((entry) => entry.name)
  if (unsupported.length > 0) {
    throw new Error(`${label} must contain only files: ${unsupported.sort().join(', ')}`)
  }
  return entries.map((entry) => entry.name).sort()
}

function compareFileSets(actual, expected, label) {
  const actualKey = actual.join('\n')
  const expectedKey = expected.join('\n')
  if (actualKey !== expectedKey) {
    const missing = expected.filter((file) => !actual.includes(file))
    const unexpected = actual.filter((file) => !expected.includes(file))
    throw new Error(`${label} file set differs (missing: ${missing.join(', ') || 'none'}; unexpected: ${unexpected.join(', ') || 'none'}).`)
  }
}

async function resolveSourceDirectory(sourceDirectory) {
  if (!sourceDirectory) {
    return undefined
  }
  const directManifest = await stat(path.join(sourceDirectory, 'contract-manifest.json')).catch(() => null)
  if (directManifest?.isFile()) {
    return sourceDirectory
  }
  const generatedDirectory = path.join(sourceDirectory, 'generated', 'contracts')
  const generatedManifest = await stat(path.join(generatedDirectory, 'contract-manifest.json')).catch(() => null)
  return generatedManifest?.isFile() ? generatedDirectory : sourceDirectory
}

export async function checkDataContracts({
  destinationDirectory = defaultContractDestination,
  lockFile = defaultContractLock,
  sourceCommit,
  sourceDirectory,
  sourceRepository,
} = {}) {
  const lock = await readJson(lockFile, 'Contract hash lock')
  validateLock(lock)
  const lockedFiles = lock.files.map(({ file }) => file).sort()
  const vendorFiles = await regularFileNames(destinationDirectory, 'Vendored contract directory')
  compareFileSets(vendorFiles, lockedFiles, 'Vendored contract')

  for (const { file, sha256 } of lock.files) {
    const actualHash = hash(await readFile(path.join(destinationDirectory, file)))
    if (actualHash !== sha256) {
      throw new Error(`${file} hash does not match data-contracts.lock.json.`)
    }
  }

  validateContractManifest(await readJson(path.join(destinationDirectory, 'contract-manifest.json'), 'Contract manifest'))

  const resolvedSource = await resolveSourceDirectory(sourceDirectory)
  if (!resolvedSource) {
    return
  }
  const currentSource = await resolveContractSourceIdentity({
    sourceCommit,
    sourceDirectory,
    sourceRepository,
  })
  if (currentSource.repository !== lock.source.repository) {
    throw new Error('Contract source repository does not match data-contracts.lock.json.')
  }
  if (currentSource.commit !== lock.source.commit) {
    throw new Error('Contract source HEAD commit does not match data-contracts.lock.json.')
  }
  const sourceFiles = await regularFileNames(resolvedSource, 'Generated contract source')
  compareFileSets(sourceFiles, vendorFiles, 'Generated source')
  for (const file of vendorFiles) {
    const [vendor, source] = await Promise.all([
      readFile(path.join(destinationDirectory, file)),
      readFile(path.join(resolvedSource, file)),
    ])
    if (!vendor.equals(source)) {
      throw new Error(`${file} differs from the generated source.`)
    }
  }
}

function optionValue(arguments_, option, { pathValue = false } = {}) {
  const index = arguments_.indexOf(option)
  if (index === -1) {
    return undefined
  }
  const value = arguments_[index + 1]
  if (!value || value.startsWith('--')) {
    throw new Error(`${option} requires a value.`)
  }
  return pathValue ? path.resolve(value) : value
}

async function main() {
  const arguments_ = process.argv.slice(2)
  const sourceDirectory = optionValue(arguments_, '--source', { pathValue: true })
  await checkDataContracts({
    sourceCommit: optionValue(arguments_, '--source-commit'),
    sourceDirectory,
    sourceRepository: optionValue(arguments_, '--source-repository'),
  })
  console.log(sourceDirectory
    ? `Vendored data contracts match their hash lock and ${sourceDirectory}.`
    : 'Vendored data contracts match their manifest and hash lock.')
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main()
}
