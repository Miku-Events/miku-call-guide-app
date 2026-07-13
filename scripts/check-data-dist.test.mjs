import { access, mkdtemp, mkdir, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { checkDataDist } from './check-data-dist.mjs'

const temporaryDirectories = []
const generatedAt = '2026-07-11T00:00:00.000Z'
const dataVersion = '20260711T0000'

async function temporaryDirectory() {
  const directory = await mkdtemp(path.join(tmpdir(), 'miku-app-data-dist-'))
  temporaryDirectories.push(directory)
  return directory
}

async function writeJson(root, relativePath, value) {
  const target = path.join(root, ...relativePath.split('/'))
  await mkdir(path.dirname(target), { recursive: true })
  await writeFile(target, `${JSON.stringify(value, null, 2)}\n`)
}

async function readJson(root, relativePath) {
  return JSON.parse(await readFile(path.join(root, ...relativePath.split('/')), 'utf8'))
}

async function writeValidDist(root) {
  const occurrence = {
    id: 'main',
    startsOn: '2026-06-15',
    timezone: 'Asia/Seoul',
  }
  await writeJson(root, 'manifest.json', {
    schemaVersion: 1,
    generatedAt,
    dataVersion,
    manifests: {
      callGuide: 'call-guide-manifest.json',
      eventCalendar: 'event-calendar/index.json',
    },
  })
  await writeJson(root, 'call-guide-manifest.json', {
    schemaVersion: 1,
    generatedAt,
    dataVersion,
    songs: [{
      id: 'sample-song',
      title: { ko: '샘플 곡' },
      artist: { ko: '샘플 작곡가' },
      youtubeVideoId: 'M7lc1UVf-VE',
      originalSongId: 'dQw4w9WgXcQ',
      tags: ['sample'],
      path: 'songs/sample-song.json',
      status: 'published',
    }],
  })
  await writeJson(root, 'songs/sample-song.json', {
    schemaVersion: 1,
    dataVersion,
    id: 'sample-song',
    status: 'published',
    metadata: {
      title: { ko: '샘플 곡' },
      artist: { ko: '샘플 작곡가' },
      vocal: ['hatsune-miku'],
      tags: ['sample'],
    },
    youtube: {
      videoId: 'M7lc1UVf-VE',
      originalSongId: 'dQw4w9WgXcQ',
      startOffsetMs: 0,
    },
    display: {
      defaultLyricsLanguage: 'ja',
      defaultPronunciationLanguage: 'koPronunciation',
      defaultCallLanguage: 'ko',
    },
    timing: { unit: 'ms', durationMs: 6000 },
    lyrics: [{
      id: 'line-001',
      time: '00:00:00,000 --> 00:00:06,000',
      text: { ja: '光るステージへ' },
      startMs: 0,
      endMs: 6000,
    }],
    callEvents: [{
      id: 'call-001',
      lyricLineId: 'line-001',
      placement: { mode: 'lyricTrack', lane: 'above', align: 'charAnchor' },
      anchor: { targetText: 'ja', unit: 'grapheme', pointChar: 3 },
      text: { ko: '하이!' },
      markers: {
        point: { enabled: true, style: 'pointArrow', direction: 'auto' },
        range: { enabled: false, style: 'none' },
      },
      activation: { mode: 'lineActive' },
      cue: { kind: 'chant', intensity: 'normal', repeat: 1 },
    }],
    notes: { author: 'contract test' },
  })
  await writeJson(root, 'event-calendar/index.json', {
    schemaVersion: 1,
    generatedAt,
    dataVersion,
    availableMonths: ['2026-06'],
    types: ['concert'],
    typePriority: ['concert'],
  })
  await writeJson(root, 'event-calendar/months/2026-06.json', {
    schemaVersion: 1,
    generatedAt,
    dataVersion,
    month: '2026-06',
    events: [{
      id: 'sample-event',
      title: { ko: '샘플 이벤트' },
      type: 'concert',
      occurrences: [occurrence],
      path: '../events/sample-event.json',
    }],
  })
  await writeJson(root, 'event-calendar/events/sample-event.json', {
    schemaVersion: 1,
    dataVersion,
    id: 'sample-event',
    status: 'published',
    title: { ko: '샘플 이벤트' },
    type: 'concert',
    occurrences: [occurrence],
    links: { sns: [{ platform: 'x', url: 'https://x.com/example/status/1' }] },
  })
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })))
})

describe('built data compatibility', () => {
  it('accepts sparse notes, originalSongId, and the complete referenced graph', async () => {
    const root = await temporaryDirectory()
    await writeValidDist(root)
    await expect(checkDataDist(root)).resolves.toMatchObject({ events: 1, months: 1, songs: 1 })
  })

  it('rejects invalid nested song data', async () => {
    const root = await temporaryDirectory()
    await writeValidDist(root)
    const song = await readJson(root, 'songs/sample-song.json')
    song.callEvents[0].text = { ko: 42 }
    await writeJson(root, 'songs/sample-song.json', song)
    await expect(checkDataDist(root)).rejects.toThrow(/sample-song\.json.*runtime song/i)
  })

  it('rejects invalid nested month data', async () => {
    const root = await temporaryDirectory()
    await writeValidDist(root)
    const month = await readJson(root, 'event-calendar/months/2026-06.json')
    delete month.events[0].occurrences[0].timezone
    await writeJson(root, 'event-calendar/months/2026-06.json', month)
    await expect(checkDataDist(root)).rejects.toThrow(/2026-06\.json.*calendar month/i)
  })

  it('rejects root-child and root-month dataVersion mixing', async () => {
    const root = await temporaryDirectory()
    await writeValidDist(root)
    const callGuide = await readJson(root, 'call-guide-manifest.json')
    callGuide.dataVersion = 'stale-child'
    await writeJson(root, 'call-guide-manifest.json', callGuide)
    await expect(checkDataDist(root)).rejects.toThrow(/dataVersion.*call-guide/i)

    callGuide.dataVersion = dataVersion
    await writeJson(root, 'call-guide-manifest.json', callGuide)
    const month = await readJson(root, 'event-calendar/months/2026-06.json')
    month.dataVersion = 'stale-month'
    await writeJson(root, 'event-calendar/months/2026-06.json', month)
    await expect(checkDataDist(root)).rejects.toThrow(/dataVersion.*2026-06/i)
  })

  it('rejects root-song and root-event leaf dataVersion mixing', async () => {
    const root = await temporaryDirectory()
    await writeValidDist(root)
    const song = await readJson(root, 'songs/sample-song.json')
    song.dataVersion = 'stale-song'
    await writeJson(root, 'songs/sample-song.json', song)
    await expect(checkDataDist(root)).rejects.toThrow(/dataVersion.*sample-song/i)

    song.dataVersion = dataVersion
    await writeJson(root, 'songs/sample-song.json', song)
    const event = await readJson(root, 'event-calendar/events/sample-event.json')
    event.dataVersion = 'stale-event'
    await writeJson(root, 'event-calendar/events/sample-event.json', event)
    await expect(checkDataDist(root)).rejects.toThrow(/dataVersion.*sample-event/i)
  })

  it('rejects an unreferenced leaf whose dataVersion differs from the root', async () => {
    const root = await temporaryDirectory()
    await writeValidDist(root)
    const song = await readJson(root, 'songs/sample-song.json')
    await writeJson(root, 'songs/unreferenced-song.json', {
      ...song,
      dataVersion: 'stale-unreferenced',
      id: 'unreferenced-song',
    })

    await expect(checkDataDist(root)).rejects.toThrow(/dataVersion.*unreferenced-song/i)
  })

  it('rejects a missing referenced payload path', async () => {
    const root = await temporaryDirectory()
    await writeValidDist(root)
    const callGuide = await readJson(root, 'call-guide-manifest.json')
    callGuide.songs[0].path = 'songs/missing.json'
    await writeJson(root, 'call-guide-manifest.json', callGuide)
    await expect(checkDataDist(root)).rejects.toThrow(/missing\.json.*referenced/i)
  })

  it('rejects referenced payload IDs that differ from their manifest entries', async () => {
    const root = await temporaryDirectory()
    await writeValidDist(root)

    const song = await readJson(root, 'songs/sample-song.json')
    song.id = 'different-valid-song-id'
    await writeJson(root, 'songs/sample-song.json', song)
    await expect(checkDataDist(root)).rejects.toThrow(/song.*id.*sample-song/i)

    song.id = 'sample-song'
    await writeJson(root, 'songs/sample-song.json', song)
    const event = await readJson(root, 'event-calendar/events/sample-event.json')
    event.id = 'different-valid-event-id'
    await writeJson(root, 'event-calendar/events/sample-event.json', event)
    await expect(checkDataDist(root)).rejects.toThrow(/event.*id.*sample-event/i)
  })

  it('rejects referenced payloads reached through a symlink or junction', async () => {
    const root = await temporaryDirectory()
    const outside = await temporaryDirectory()
    await writeValidDist(root)
    const outsideSongs = path.join(outside, 'songs')
    await rename(path.join(root, 'songs'), outsideSongs)
    await symlink(outsideSongs, path.join(root, 'songs'), process.platform === 'win32' ? 'junction' : 'dir')

    await expect(checkDataDist(root)).rejects.toThrow(/link|outside.*data dist/i)
  })

  it('rejects unreferenced payload scans reached through a symlink or junction', async () => {
    const root = await temporaryDirectory()
    const outside = await temporaryDirectory()
    await writeValidDist(root)
    const callGuide = await readJson(root, 'call-guide-manifest.json')
    callGuide.songs = []
    await writeJson(root, 'call-guide-manifest.json', callGuide)
    const outsideSongs = path.join(outside, 'songs')
    await rename(path.join(root, 'songs'), outsideSongs)
    await symlink(outsideSongs, path.join(root, 'songs'), process.platform === 'win32' ? 'junction' : 'dir')

    await expect(checkDataDist(root)).rejects.toThrow(/link|outside.*data dist/i)
  })
})

const siblingDist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../miku-call-guide-data/dist')
let siblingDistExists = true
try {
  await access(path.join(siblingDist, 'manifest.json'))
} catch {
  siblingDistExists = false
}

describe('sibling data repository compatibility', () => {
  it.skipIf(!siblingDistExists)('validates the actual sibling build output', async () => {
    await expect(checkDataDist(siblingDist)).resolves.toMatchObject({
      events: expect.any(Number),
      months: expect.any(Number),
      songs: expect.any(Number),
    })
  })
})
