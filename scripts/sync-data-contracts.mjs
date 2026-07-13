import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const appRoot = path.resolve(scriptDirectory, '..')

export const defaultContractSource = path.resolve(appRoot, '../miku-call-guide-data/generated/contracts')
export const defaultContractDestination = path.join(appRoot, 'data-contracts')
export const defaultContractLock = path.join(appRoot, 'data-contracts.lock.json')
export const expectedContractSourceRepository = 'Miku-Events/miku-call-guide-data'

const requiredContractFiles = new Set([
  'contract-manifest.json',
  'event-types.d.mts',
  'event-types.mjs',
  'types.ts',
  'validators.d.mts',
  'validators.mjs',
])
const fullCommitPattern = /^[a-f0-9]{40}$/
const runProcess = promisify(execFile)

function hash(contents) {
  return createHash('sha256').update(contents).digest('hex')
}

async function contractFiles(sourceDirectory) {
  const entries = await readdir(sourceDirectory, { withFileTypes: true })
  const unsupported = entries.filter((entry) => !entry.isFile()).map((entry) => entry.name)
  if (unsupported.length > 0) {
    throw new Error(`Generated contract source must contain only files: ${unsupported.sort().join(', ')}`)
  }

  const files = entries.map((entry) => entry.name).sort()
  const missing = [...requiredContractFiles].filter((file) => !files.includes(file)).sort()
  if (missing.length > 0) {
    throw new Error(`Generated contract source is incomplete: ${missing.join(', ')}`)
  }
  return files
}

async function atomicWrite(target, contents) {
  await mkdir(path.dirname(target), { recursive: true })
  const temporary = `${target}.${process.pid}.tmp`
  await writeFile(temporary, contents)
  await rm(target, { force: true })
  await rename(temporary, target)
}

function repositoryFromRemote(remote) {
  const value = remote.trim()
  const httpsMatch = /^https:\/\/github\.com\/([^/\s]+\/[^/\s]+?)(?:\.git)?\/?$/.exec(value)
  if (httpsMatch) {
    return httpsMatch[1]
  }
  const sshMatch = /^git@github\.com:([^/\s]+\/[^/\s]+?)(?:\.git)?$/.exec(value)
  if (sshMatch) {
    return sshMatch[1]
  }
  const sshUrlMatch = /^ssh:\/\/git@github\.com\/([^/\s]+\/[^/\s]+?)(?:\.git)?\/?$/.exec(value)
  if (sshUrlMatch) {
    return sshUrlMatch[1]
  }
  throw new Error('Contract source repository must use an uncredentialed GitHub origin URL.')
}

function validateSourceIdentity(repository, commit) {
  if (repository !== expectedContractSourceRepository) {
    throw new Error(`Contract source repository must be ${expectedContractSourceRepository}.`)
  }
  if (!fullCommitPattern.test(commit)) {
    throw new Error('Contract source commit must be a full lowercase 40-character SHA.')
  }
  return { repository, commit }
}

async function gitOutput(sourceDirectory, arguments_, label) {
  try {
    const { stdout } = await runProcess('git', ['-C', sourceDirectory, ...arguments_], {
      encoding: 'utf8',
      windowsHide: true,
    })
    return stdout.trim()
  } catch {
    throw new Error(`Could not identify contract source ${label} from Git.`)
  }
}

export async function resolveContractSourceIdentity({
  sourceCommit,
  sourceDirectory,
  sourceRepository,
}) {
  if (!sourceDirectory) {
    throw new Error('Contract source directory is required to resolve source identity.')
  }
  const hasExplicitRepository = typeof sourceRepository === 'string' && sourceRepository.length > 0
  const hasExplicitCommit = typeof sourceCommit === 'string' && sourceCommit.length > 0
  if (hasExplicitRepository !== hasExplicitCommit) {
    throw new Error('Contract source repository and commit must be provided together.')
  }
  if (hasExplicitRepository) {
    return validateSourceIdentity(sourceRepository, sourceCommit)
  }

  const [remote, commit] = await Promise.all([
    gitOutput(sourceDirectory, ['remote', 'get-url', 'origin'], 'repository'),
    gitOutput(sourceDirectory, ['rev-parse', 'HEAD'], 'HEAD commit'),
  ])
  return validateSourceIdentity(repositoryFromRemote(remote), commit)
}

export async function syncDataContracts({
  destinationDirectory = defaultContractDestination,
  lockFile = defaultContractLock,
  sourceCommit,
  sourceDirectory = defaultContractSource,
  sourceRepository,
} = {}) {
  const sourceStat = await lstat(sourceDirectory).catch(() => null)
  if (!sourceStat?.isDirectory()) {
    throw new Error(`Generated contract source does not exist: ${sourceDirectory}`)
  }

  const source = await resolveContractSourceIdentity({
    sourceCommit,
    sourceDirectory,
    sourceRepository,
  })
  const files = await contractFiles(sourceDirectory)
  const contents = new Map(await Promise.all(files.map(async (file) => [file, await readFile(path.join(sourceDirectory, file))])))
  const destinationParent = path.dirname(destinationDirectory)
  await mkdir(destinationParent, { recursive: true })
  const stagingDirectory = await mkdtemp(path.join(destinationParent, '.data-contracts-sync-'))

  try {
    await Promise.all(files.map((file) => writeFile(path.join(stagingDirectory, file), contents.get(file))))
    await rm(destinationDirectory, { force: true, recursive: true })
    await rename(stagingDirectory, destinationDirectory)
  } catch (error) {
    await rm(stagingDirectory, { force: true, recursive: true })
    throw error
  }

  const lock = {
    schemaVersion: 1,
    source,
    files: files.map((file) => ({ file, sha256: hash(contents.get(file)) })),
  }
  await atomicWrite(lockFile, `${JSON.stringify(lock, null, 2)}\n`)
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
  const sourceDirectory = optionValue(arguments_, '--source', { pathValue: true }) ?? defaultContractSource
  await syncDataContracts({
    sourceCommit: optionValue(arguments_, '--source-commit'),
    sourceDirectory,
    sourceRepository: optionValue(arguments_, '--source-repository'),
  })
  console.log(`Synchronized generated data contracts from ${sourceDirectory}.`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main()
}
