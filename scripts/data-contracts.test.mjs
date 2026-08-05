import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import { validateBody } from '../functions/api/events/submissions.js'
import { EVENT_TYPES } from '../data-contracts/event-types.mjs'
import { checkDataContracts } from './check-data-contracts.mjs'
import { syncDataContracts } from './sync-data-contracts.mjs'

const temporaryDirectories = []
const runProcess = promisify(execFile)
const sourceRepository = 'Miku-Events/miku-call-guide-data'
const sourceCommit = 'a'.repeat(40)

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

async function temporaryDirectory() {
  const directory = await mkdtemp(path.join(tmpdir(), 'miku-app-contracts-'))
  temporaryDirectories.push(directory)
  return directory
}

async function writeContractSource(directory) {
  await mkdir(directory, { recursive: true })
  const files = {
    'contract-manifest.json': `${JSON.stringify({
      schemaVersion: 1,
      schemas: [{ file: 'schemas/runtime-song.schema.json', sha256: 'a'.repeat(64) }],
    }, null, 2)}\n`,
    'event-types.d.mts': 'export declare const EVENT_TYPES: readonly ["concert"];\n',
    'event-types.mjs': 'export const EVENT_TYPES = Object.freeze(["concert"]);\n',
    'types.ts': 'export interface RuntimeSong { schemaVersion: 1 }\n',
    'validators.d.mts': 'export declare const validateRuntimeSong: (value: unknown) => boolean;\n',
    'validators.mjs': 'export const validateRuntimeSong = () => true;\n',
  }

  await Promise.all(Object.entries(files).map(([file, contents]) => writeFile(path.join(directory, file), contents)))
  return files
}

function explicitSource(sourceDirectory) {
  return { sourceCommit, sourceDirectory, sourceRepository }
}

async function createGitContractSource(root) {
  const repositoryRoot = path.join(root, 'source-repository')
  const sourceDirectory = path.join(repositoryRoot, 'generated', 'contracts')
  await writeContractSource(sourceDirectory)
  await runProcess('git', ['init'], { cwd: repositoryRoot })
  await runProcess('git', ['config', 'user.email', 'contracts@example.test'], { cwd: repositoryRoot })
  await runProcess('git', ['config', 'user.name', 'Contract Tests'], { cwd: repositoryRoot })
  await runProcess('git', ['remote', 'add', 'origin', `https://github.com/${sourceRepository}.git`], { cwd: repositoryRoot })
  await runProcess('git', ['add', '.'], { cwd: repositoryRoot })
  await runProcess('git', ['commit', '-m', 'initial contracts'], { cwd: repositoryRoot })
  const { stdout } = await runProcess('git', ['rev-parse', 'HEAD'], { cwd: repositoryRoot })
  return { commit: stdout.trim(), repositoryRoot, sourceDirectory }
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })))
})

describe('vendored data contracts', () => {
  it('syncs one byte-identical generated copy and a deterministic hash lock', async () => {
    const root = await temporaryDirectory()
    const sourceDirectory = path.join(root, 'source')
    const destinationDirectory = path.join(root, 'data-contracts')
    const lockFile = path.join(root, 'data-contracts.lock.json')
    const sourceFiles = await writeContractSource(sourceDirectory)

    await syncDataContracts({ destinationDirectory, lockFile, ...explicitSource(sourceDirectory) })

    for (const [file, contents] of Object.entries(sourceFiles)) {
      expect(await readFile(path.join(destinationDirectory, file), 'utf8')).toBe(contents)
    }
    const lock = JSON.parse(await readFile(lockFile, 'utf8'))
    expect(lock).toEqual({
      schemaVersion: 1,
      source: {
        repository: sourceRepository,
        commit: sourceCommit,
      },
      files: Object.entries(sourceFiles)
        .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
        .map(([file, contents]) => ({ file, sha256: sha256(contents) })),
    })
  })

  it('detects a changed vendored file from its committed hash lock', async () => {
    const root = await temporaryDirectory()
    const sourceDirectory = path.join(root, 'source')
    const destinationDirectory = path.join(root, 'data-contracts')
    const lockFile = path.join(root, 'data-contracts.lock.json')
    await writeContractSource(sourceDirectory)
    await syncDataContracts({ destinationDirectory, lockFile, ...explicitSource(sourceDirectory) })
    await writeFile(path.join(destinationDirectory, 'types.ts'), 'export type Drift = true\n')

    await expect(checkDataContracts({ destinationDirectory, lockFile })).rejects.toThrow(/types\.ts.*hash/i)
  })

  it('validates the contract manifest and every locked file hash', async () => {
    const root = await temporaryDirectory()
    const sourceDirectory = path.join(root, 'source')
    const destinationDirectory = path.join(root, 'data-contracts')
    const lockFile = path.join(root, 'data-contracts.lock.json')
    await writeContractSource(sourceDirectory)
    await syncDataContracts({ destinationDirectory, lockFile, ...explicitSource(sourceDirectory) })

    await expect(checkDataContracts({ destinationDirectory, lockFile })).resolves.toBeUndefined()

    const manifestPath = path.join(destinationDirectory, 'contract-manifest.json')
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
    manifest.schemas[0].sha256 = 'not-a-hash'
    const changedManifest = `${JSON.stringify(manifest, null, 2)}\n`
    await writeFile(manifestPath, changedManifest)
    const lock = JSON.parse(await readFile(lockFile, 'utf8'))
    lock.files.find(({ file }) => file === 'contract-manifest.json').sha256 = sha256(changedManifest)
    await writeFile(lockFile, `${JSON.stringify(lock, null, 2)}\n`)

    await expect(checkDataContracts({ destinationDirectory, lockFile })).rejects.toThrow(/manifest.*sha256/i)
  })

  it('byte-compares the vendor against an explicit generated source', async () => {
    const root = await temporaryDirectory()
    const sourceDirectory = path.join(root, 'source')
    const destinationDirectory = path.join(root, 'data-contracts')
    const lockFile = path.join(root, 'data-contracts.lock.json')
    await writeContractSource(sourceDirectory)
    await syncDataContracts({ destinationDirectory, lockFile, ...explicitSource(sourceDirectory) })

    await expect(checkDataContracts({
      destinationDirectory,
      lockFile,
      ...explicitSource(sourceDirectory),
    })).resolves.toBeUndefined()
    await writeFile(path.join(sourceDirectory, 'event-types.mjs'), 'export const EVENT_TYPES = [];\n')
    await expect(checkDataContracts({
      destinationDirectory,
      lockFile,
      ...explicitSource(sourceDirectory),
    })).rejects.toThrow(
      /event-types\.mjs.*source/i,
    )
  })

  it('rejects malformed or unexpected lock source metadata', async () => {
    const root = await temporaryDirectory()
    const sourceDirectory = path.join(root, 'source')
    const destinationDirectory = path.join(root, 'data-contracts')
    const lockFile = path.join(root, 'data-contracts.lock.json')
    await writeContractSource(sourceDirectory)
    await syncDataContracts({ destinationDirectory, lockFile, ...explicitSource(sourceDirectory) })

    const lock = JSON.parse(await readFile(lockFile, 'utf8'))
    lock.source.commit = 'short'
    await writeFile(lockFile, `${JSON.stringify(lock, null, 2)}\n`)
    await expect(checkDataContracts({ destinationDirectory, lockFile })).rejects.toThrow(/source.*commit/i)

    lock.source.commit = sourceCommit
    lock.source.repository = 'attacker/example'
    await writeFile(lockFile, `${JSON.stringify(lock, null, 2)}\n`)
    await expect(checkDataContracts({ destinationDirectory, lockFile })).rejects.toThrow(/source.*repository/i)
  })

  it('records the source git remote and rejects source HEAD drift', async () => {
    const root = await temporaryDirectory()
    const destinationDirectory = path.join(root, 'data-contracts')
    const lockFile = path.join(root, 'data-contracts.lock.json')
    const source = await createGitContractSource(root)

    await syncDataContracts({
      destinationDirectory,
      lockFile,
      sourceDirectory: source.sourceDirectory,
    })
    const lock = JSON.parse(await readFile(lockFile, 'utf8'))
    expect(lock.source).toEqual({ repository: sourceRepository, commit: source.commit })
    await expect(checkDataContracts({
      destinationDirectory,
      lockFile,
      sourceDirectory: source.sourceDirectory,
    })).resolves.toBeUndefined()

    await writeFile(path.join(source.repositoryRoot, 'README.md'), 'source drift\n')
    await runProcess('git', ['add', 'README.md'], { cwd: source.repositoryRoot })
    await runProcess('git', ['commit', '-m', 'advance source'], { cwd: source.repositoryRoot })
    await expect(checkDataContracts({
      destinationDirectory,
      lockFile,
      sourceDirectory: source.sourceDirectory,
    })).rejects.toThrow(/source.*HEAD|commit/i)
  })
})

describe('generated event type parity', () => {
  const validSubmission = {
    title: 'Contract parity event',
    timezone: 'Asia/Seoul',
    snsUrl: 'https://x.com/example/status/1',
    startsOn: '2026-07-11',
  }

  it.each(EVENT_TYPES)('accepts generated event type %s in the write API', (type) => {
    expect(validateBody({ ...validSubmission, type })).not.toContain('type is not supported')
  })

  it('rejects a value outside the generated event enum', () => {
    expect(validateBody({ ...validSubmission, type: 'not-generated' })).toContain('type is not supported')
  })
})
