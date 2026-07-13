import { lstat, readdir, readFile, realpath } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const appRoot = path.resolve(scriptDirectory, '..')
export const defaultDataDist = path.resolve(appRoot, '../miku-call-guide-data/dist')
const defaultValidatorsUrl = pathToFileURL(path.join(appRoot, 'data-contracts/validators.mjs')).href

function validationDetails(validator) {
  return (validator.errors ?? [])
    .slice(0, 5)
    .map((error) => `${error.instancePath || '/'} ${error.message ?? error.keyword}`)
    .join('; ')
}

function validate(value, validator, file, label) {
  if (!validator(value)) {
    throw new Error(`${file} failed ${label} validation: ${validationDetails(validator) || 'unknown contract error'}`)
  }
  return value
}

function isOutsideDirectory(directory, target) {
  const relative = path.relative(directory, target)
  return relative === '' || relative.startsWith(`..${path.sep}`) || relative === '..' || path.isAbsolute(relative)
}

async function assertInsideDist(distDirectory, realDistDirectory, target, reference) {
  if (isOutsideDirectory(distDirectory, target)) {
    throw new Error(`${reference} referenced a path outside the data dist.`)
  }

  const relative = path.relative(distDirectory, target)
  let current = distDirectory
  for (const segment of relative.split(path.sep)) {
    current = path.join(current, segment)
    const fileStat = await lstat(current).catch((error) => {
      if (error && typeof error === 'object' && error.code === 'ENOENT') {
        throw new Error(`${target} referenced payload does not exist.`)
      }
      throw error
    })
    if (fileStat.isSymbolicLink()) {
      throw new Error(`${reference} referenced a symbolic link or junction inside the data dist.`)
    }
  }

  const realTarget = await realpath(target)
  if (isOutsideDirectory(realDistDirectory, realTarget)) {
    throw new Error(`${reference} resolved outside the data dist.`)
  }
}

async function readJson(file, label) {
  let source
  try {
    source = await readFile(file, 'utf8')
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') {
      throw new Error(`${file} referenced payload does not exist.`)
    }
    throw error
  }
  try {
    return JSON.parse(source)
  } catch (error) {
    throw new Error(`${file} is not valid JSON for ${label}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

async function referencedJson(distDirectory, realDistDirectory, fromFile, reference, label) {
  const target = path.resolve(path.dirname(fromFile), reference)
  await assertInsideDist(distDirectory, realDistDirectory, target, reference)
  return { file: target, value: await readJson(target, label) }
}

function assertDataVersion(rootVersion, value, label) {
  if (value.dataVersion !== rootVersion) {
    throw new Error(`dataVersion mismatch for ${label}: expected ${rootVersion}, received ${String(value.dataVersion)}.`)
  }
}

async function jsonFiles(directory, distDirectory, realDistDirectory) {
  const directoryStat = await lstat(directory).catch(() => null)
  if (!directoryStat?.isDirectory()) {
    if (directoryStat?.isSymbolicLink()) {
      throw new Error(`${directory} is a symbolic link or junction inside the data dist.`)
    }
    return []
  }
  await assertInsideDist(distDirectory, realDistDirectory, directory, directory)
  const entries = await readdir(directory, { withFileTypes: true })
  const nested = await Promise.all(entries.map(async (entry) => {
    const target = path.join(directory, entry.name)
    if (entry.isSymbolicLink()) {
      throw new Error(`${target} is a symbolic link or junction inside the data dist.`)
    }
    if (entry.isDirectory()) {
      return jsonFiles(target, distDirectory, realDistDirectory)
    }
    if (entry.isFile() && entry.name.endsWith('.json')) {
      await assertInsideDist(distDirectory, realDistDirectory, target, target)
      return [target]
    }
    return []
  }))
  return nested.flat().sort()
}

async function loadValidators(validators) {
  if (validators) {
    return validators
  }
  try {
    return await import(defaultValidatorsUrl)
  } catch (error) {
    throw new Error(`Generated data validators are unavailable. Run npm run contracts:sync first. ${error instanceof Error ? error.message : String(error)}`)
  }
}

export async function checkDataDist(distDirectory = defaultDataDist, options = {}) {
  const rootDirectory = path.resolve(distDirectory)
  const realRootDirectory = await realpath(rootDirectory)
  const validators = await loadValidators(options.validators)
  const rootFile = path.join(rootDirectory, 'manifest.json')
  await assertInsideDist(rootDirectory, realRootDirectory, rootFile, 'manifest.json')
  const root = validate(
    await readJson(rootFile, 'root manifest'),
    validators.validateRootManifest,
    rootFile,
    'root manifest',
  )

  const callGuideResult = await referencedJson(rootDirectory, realRootDirectory, rootFile, root.manifests.callGuide, 'call-guide manifest')
  const callGuide = validate(
    callGuideResult.value,
    validators.validateCallGuideManifest,
    callGuideResult.file,
    'call-guide manifest',
  )
  assertDataVersion(root.dataVersion, callGuide, 'call-guide manifest')

  const calendarResult = await referencedJson(rootDirectory, realRootDirectory, rootFile, root.manifests.eventCalendar, 'event calendar index')
  const calendar = validate(
    calendarResult.value,
    validators.validateEventCalendarIndex,
    calendarResult.file,
    'event calendar index',
  )
  assertDataVersion(root.dataVersion, calendar, 'event calendar index')

  const referencedSongFiles = new Set()
  for (const song of callGuide.songs) {
    const result = await referencedJson(rootDirectory, realRootDirectory, callGuideResult.file, song.path, 'runtime song')
    referencedSongFiles.add(result.file)
    const runtimeSong = validate(result.value, validators.validateRuntimeSong, result.file, 'runtime song')
    assertDataVersion(root.dataVersion, runtimeSong, song.id)
    if (runtimeSong.id !== song.id) {
      throw new Error(`Song id mismatch for ${song.id}: referenced payload declares ${runtimeSong.id}.`)
    }
  }
  const allSongFiles = new Set([
    ...referencedSongFiles,
    ...await jsonFiles(path.join(rootDirectory, 'songs'), rootDirectory, realRootDirectory),
  ])
  for (const file of allSongFiles) {
    if (!referencedSongFiles.has(file)) {
      const runtimeSong = validate(
        await readJson(file, 'runtime song'),
        validators.validateRuntimeSong,
        file,
        'runtime song',
      )
      assertDataVersion(root.dataVersion, runtimeSong, path.basename(file, '.json'))
    }
  }

  const referencedMonthFiles = new Set()
  for (const month of calendar.availableMonths) {
    const result = await referencedJson(rootDirectory, realRootDirectory, calendarResult.file, `months/${month}.json`, 'event calendar month')
    referencedMonthFiles.add(result.file)
  }
  const allMonthFiles = new Set([
    ...referencedMonthFiles,
    ...await jsonFiles(
      path.join(path.dirname(calendarResult.file), 'months'),
      rootDirectory,
      realRootDirectory,
    ),
  ])
  const referencedEventFiles = new Set()
  for (const file of allMonthFiles) {
    const month = validate(
      await readJson(file, 'event calendar month'),
      validators.validateEventCalendarMonth,
      file,
      'event calendar month',
    )
    assertDataVersion(root.dataVersion, month, path.basename(file, '.json'))
    const expectedMonth = path.basename(file, '.json')
    if (month.month !== expectedMonth) {
      throw new Error(`${file} declares month ${month.month}, expected ${expectedMonth}.`)
    }
    for (const event of month.events) {
      const result = await referencedJson(rootDirectory, realRootDirectory, file, event.path, 'runtime event')
      referencedEventFiles.add(result.file)
      const runtimeEvent = validate(result.value, validators.validateRuntimeEvent, result.file, 'runtime event')
      assertDataVersion(root.dataVersion, runtimeEvent, event.id)
      if (runtimeEvent.id !== event.id) {
        throw new Error(`Event id mismatch for ${event.id}: referenced payload declares ${runtimeEvent.id}.`)
      }
    }
  }
  const allEventFiles = new Set([
    ...referencedEventFiles,
    ...await jsonFiles(
      path.join(path.dirname(calendarResult.file), 'events'),
      rootDirectory,
      realRootDirectory,
    ),
  ])
  for (const file of allEventFiles) {
    if (!referencedEventFiles.has(file)) {
      const runtimeEvent = validate(
        await readJson(file, 'runtime event'),
        validators.validateRuntimeEvent,
        file,
        'runtime event',
      )
      assertDataVersion(root.dataVersion, runtimeEvent, path.basename(file, '.json'))
    }
  }

  return {
    songs: allSongFiles.size,
    months: allMonthFiles.size,
    events: allEventFiles.size,
  }
}

function optionValue(arguments_, option) {
  const index = arguments_.indexOf(option)
  if (index === -1) {
    return undefined
  }
  const value = arguments_[index + 1]
  if (!value || value.startsWith('--')) {
    throw new Error(`${option} requires a path.`)
  }
  return path.resolve(value)
}

async function main() {
  const distDirectory = optionValue(process.argv.slice(2), '--dist') ?? defaultDataDist
  const summary = await checkDataDist(distDirectory)
  console.log(`Validated data dist: ${summary.songs} songs, ${summary.months} months, ${summary.events} events.`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main()
}
