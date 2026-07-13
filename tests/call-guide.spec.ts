import { expect, test } from '@playwright/test'
import { validateRuntimeSong } from '../data-contracts/validators.mjs'

const rootManifest = {
  schemaVersion: 1,
  generatedAt: '2026-05-18T00:00:00.000Z',
  dataVersion: 'e2e',
  manifests: {
    callGuide: 'call-guide-manifest.json',
    eventCalendar: 'event-calendar/index.json',
  },
}

const callGuideManifest = {
  schemaVersion: 1,
  generatedAt: '2026-05-18T00:00:00.000Z',
  dataVersion: 'e2e',
  songs: [
    {
      id: 'future-light-sample',
      title: { ko: '퓨처 라이트 샘플', ja: 'Future Light Sample' },
      artist: { ko: '하츠네 미쿠 팬 샘플' },
      youtubeVideoId: 'M7lc1UVf-VE',
      originalSongId: 'iAU1LmhtCSw',
      tags: ['sample'],
      path: 'songs/future-light-sample.json',
      status: 'published',
      callSummary: {
        ko: [
          '후렴 응원 콜 중심',
          '인트로 박자에 맞춰 손을 들어 시작',
          'A멜로는 낮은 목소리로 짧게 반응',
          'B멜로 후반부터 펜라이트 방향 전환',
          '후렴 첫 줄은 하이 콜을 두 번 반복',
          '후렴 둘째 줄은 오- 콜을 길게 유지',
          '브릿지는 박수보다 리듬 콜 우선',
          '마지막 후렴은 전체 콜을 한 번 더 반복',
        ].join('\n'),
      },
    },
  ],
}

const eventCalendarIndex = {
  schemaVersion: 1,
  generatedAt: '2026-05-18T00:00:00.000Z',
  dataVersion: 'e2e',
  availableMonths: ['2026-05', '2026-06'],
  types: ['concert', 'popup'],
  typePriority: ['popup', 'concert'],
}

const multiDayEventSummary = {
  id: 'miku-multi-day-popup-sample',
  title: { ko: '하츠네 미쿠 다일 팝업 샘플' },
  type: 'popup',
  occurrences: [
    {
      id: 'opening-period',
      startsAt: '2026-05-21T10:00:00+09:00',
      endsAt: '2026-05-23T20:00:00+09:00',
      timezone: 'Asia/Seoul',
    },
    {
      id: 'encore-period',
      startsAt: '2026-05-30T10:00:00+09:00',
      endsAt: '2026-06-02T20:00:00+09:00',
      timezone: 'Asia/Seoul',
    },
  ],
  path: '../events/miku-multi-day-popup-sample.json',
}

const dateOnlyEventSummary = {
  id: 'second-miku-thanks-festival-2026',
  title: { ko: '제2회 미쿠감사제: 우리들의 즐거운 시간' },
  type: 'popup',
  occurrences: [
    {
      id: 'date-only-period',
      startsOn: '2026-05-29',
      endsOn: '2026-06-07',
      timezone: 'Asia/Seoul',
    },
  ],
  path: '../events/second-miku-thanks-festival-2026.json',
}

const laneBaseEventSummary = {
  id: 'lane-base-week-sample',
  title: { ko: '레인 기준 장기 샘플' },
  type: 'concert',
  occurrences: [
    {
      id: 'base-period',
      startsOn: '2026-05-10',
      endsOn: '2026-05-16',
      timezone: 'Asia/Seoul',
    },
  ],
  path: '../events/lane-base-week-sample.json',
}

const laneMiddleEventSummary = {
  id: 'lane-middle-week-sample',
  title: { ko: '레인 중간 종료 샘플' },
  type: 'popup',
  occurrences: [
    {
      id: 'middle-period',
      startsOn: '2026-05-11',
      endsOn: '2026-05-13',
      timezone: 'Asia/Seoul',
    },
  ],
  path: '../events/lane-middle-week-sample.json',
}

const laneUpperEventSummary = {
  id: 'lane-upper-week-sample',
  title: { ko: '레인 상단 지속 샘플' },
  type: 'popup',
  occurrences: [
    {
      id: 'upper-period',
      startsOn: '2026-05-12',
      endsOn: '2026-05-16',
      timezone: 'Asia/Seoul',
    },
  ],
  path: '../events/lane-upper-week-sample.json',
}

const laneReuseEventSummary = {
  id: 'lane-reuse-day-sample',
  title: { ko: '레인 재사용 하루 샘플' },
  type: 'popup',
  occurrences: [
    {
      id: 'reuse-day',
      startsOn: '2026-05-14',
      endsOn: '2026-05-14',
      timezone: 'Asia/Seoul',
    },
  ],
  path: '../events/lane-reuse-day-sample.json',
}

const eventCalendarMayMonth = {
  schemaVersion: 1,
  generatedAt: '2026-05-18T00:00:00.000Z',
  dataVersion: 'e2e',
  month: '2026-05',
  events: [
    laneBaseEventSummary,
    laneMiddleEventSummary,
    laneUpperEventSummary,
    laneReuseEventSummary,
    multiDayEventSummary,
    dateOnlyEventSummary,
  ],
}

const eventCalendarMonth = {
  schemaVersion: 1,
  generatedAt: '2026-05-18T00:00:00.000Z',
  dataVersion: 'e2e',
  month: '2026-06',
  events: [
    dateOnlyEventSummary,
    {
      id: 'miku-practice-sample',
      title: { ko: '하츠네 미쿠 예습 샘플' },
      type: 'concert',
      occurrences: [
        {
          id: 'day-1',
          startsAt: '2026-06-15T18:00:00+09:00',
          endsAt: '2026-06-15T20:00:00+09:00',
          timezone: 'Asia/Seoul',
        },
      ],
      path: '../events/miku-practice-sample.json',
    },
  ],
}

const multiDayEventDetail = {
  schemaVersion: 1,
  id: 'miku-multi-day-popup-sample',
  status: 'published',
  title: { ko: '하츠네 미쿠 다일 팝업 샘플' },
  type: 'popup',
  summary: { ko: '여러 날짜에 걸친 일정 표시 테스트입니다.' },
  occurrences: multiDayEventSummary.occurrences,
  location: {
    country: 'KR',
    region: { ko: '서울' },
    venue: { ko: '샘플 팝업 스토어' },
  },
  links: {
    official: 'https://example.com/miku-multi-day-popup-sample',
    sns: [{ platform: 'x', url: 'https://x.com/example/status/789', embed: true }],
  },
}

const dateOnlyEventDetail = {
  schemaVersion: 1,
  id: 'second-miku-thanks-festival-2026',
  status: 'published',
  title: { ko: '제2회 미쿠감사제: 우리들의 즐거운 시간' },
  type: 'popup',
  summary: { ko: '시간이 별도 지정되지 않은 날짜 전용 이벤트입니다.' },
  occurrences: dateOnlyEventSummary.occurrences,
  location: {
    country: 'KR',
    region: { ko: '서울' },
    venue: { ko: '레조네 (RESONE)' },
  },
  links: {
    sns: [{ platform: 'x', url: 'https://x.com/rebomofficial/status/2048688852467064858', embed: true }],
  },
}

const eventDetail = {
  schemaVersion: 1,
  id: 'miku-practice-sample',
  status: 'published',
  title: { ko: '하츠네 미쿠 예습 샘플' },
  type: 'concert',
  summary: { ko: '콜가이드 앱 검증을 위한 샘플 이벤트입니다.' },
  occurrences: eventCalendarMonth.events[0].occurrences,
  location: {
    country: 'KR',
    region: { ko: '서울' },
    venue: { ko: '샘플 공연장' },
  },
  links: {
    official: 'https://example.com/miku-practice-sample',
    sns: [{ platform: 'x', url: 'https://x.com/example/status/123', embed: true }],
  },
}

const song = {
  schemaVersion: 1,
  id: 'future-light-sample',
  status: 'published',
  metadata: {
    title: { ko: '퓨처 라이트 샘플', ja: 'Future Light Sample' },
    artist: { ko: '하츠네 미쿠 팬 샘플' },
    vocal: ['hatsune-miku'],
    tags: ['sample'],
  },
  youtube: { videoId: 'M7lc1UVf-VE', startOffsetMs: 0 },
  display: {
    defaultLyricsLanguage: 'ja',
    defaultPronunciationLanguage: 'koPronunciation',
    defaultCallLanguage: 'ko',
  },
  timing: { unit: 'ms', durationMs: 24000 },
  lyrics: [
    {
      id: 'line-001',
      time: '00:00:00,000 --> 00:00:06,000',
      startMs: 0,
      endMs: 6000,
      text: { ja: '光るステージへ', koPronunciation: '히카루 스테-지에' },
    },
    {
      id: 'line-002',
      time: '00:00:06,000 --> 00:00:12,000',
      startMs: 6000,
      endMs: 12000,
      text: { ja: '声を重ねよう', koPronunciation: '코에오 카사네요-' },
    },
  ],
  callEvents: [
    {
      id: 'call-001',
      lyricLineId: 'line-001',
      placement: { mode: 'lyricTrack', lane: 'above', align: 'charAnchor' },
      anchor: { targetText: 'ja', unit: 'grapheme', pointChar: 3, rangeStartChar: 3, rangeEndChar: 5 },
      text: { ko: '하이! 하이!' },
      markers: {
        point: { enabled: true, style: 'pointArrow', direction: 'auto' },
        range: { enabled: true, style: 'bracket' },
      },
      activation: { mode: 'lineActive' },
      cue: { kind: 'chant', intensity: 'normal', repeat: 2 },
    },
    {
      id: 'call-002',
      lyricLineId: 'line-002',
      placement: { mode: 'lyricTrack', lane: 'below', align: 'charAnchor' },
      anchor: { targetText: 'ja', unit: 'grapheme', pointChar: 4 },
      text: { ko: '오-!' },
      markers: {
        point: { enabled: true, style: 'pointArrow', direction: 'auto' },
        range: { enabled: false, style: 'none' },
      },
      activation: { mode: 'lineActive' },
      cue: { kind: 'penlight', intensity: 'low', repeat: 1 },
    },
  ],
  notes: { author: 'e2e', source: 'e2e', reviewComment: '', copyrightNote: '' },
}

const longLyricSong = {
  ...song,
  lyrics: [
    {
      ...song.lyrics[0],
      text: {
        ja: '光るステージへきらりと輝く言葉僕は探し続けた色褪せる時間にさえ気づかないでいた',
        koPronunciation:
          '히카루 스테이지에 키라리토 카가야쿠 코토바 보쿠와 사가시츠즈케타 이로아세루 지칸니사에 키즈카나이데 이타',
      },
    },
    song.lyrics[1],
  ],
}

const wordWrapSong = {
  ...song,
  lyrics: [
    {
      ...song.lyrics[0],
      text: {
        ja: 'METEOR Future Light',
        koPronunciation: '메테오 퓨처 라이트',
      },
    },
    song.lyrics[1],
  ],
}

const wrappedRangeSong = {
  ...song,
  lyrics: [
    {
      ...song.lyrics[0],
      text: {
        ja: '君に伝えたい声も  輝けるのかな',
        koPronunciation: '키미니 츠타에타이 코에모  카가야케루노카나',
      },
    },
    song.lyrics[1],
  ],
  callEvents: [
    {
      ...song.callEvents[0],
      anchor: { targetText: 'ja', unit: 'grapheme', pointChar: 7, rangeStartChar: 7, rangeEndChar: 16 },
      text: { ko: '하이 세노! 하이! 하이! 하이하이하이하이!' },
    },
    song.callEvents[1],
  ],
}

const endAnchorText = 'ABCDEFGHIJ KLMNOPQRST UVWXYZ ABCDEFGHIJ KLMNOPQRST UVWXYZ'

const endAnchorSong = {
  ...song,
  lyrics: [
    {
      ...song.lyrics[0],
      text: {
        ja: endAnchorText,
        koPronunciation: '엔드 앵커 테스트',
      },
    },
    song.lyrics[1],
  ],
  callEvents: [
    {
      ...song.callEvents[0],
      anchor: { targetText: 'ja', unit: 'grapheme', pointChar: endAnchorText.length + 1 },
      text: { ko: '끝점 콜!' },
      markers: {
        point: { enabled: true, style: 'pointArrow', direction: 'auto' },
        range: { enabled: false, style: 'none' },
      },
    },
    song.callEvents[1],
  ],
}

const attakaitoWrappedEndAnchorSong = {
  ...song,
  lyrics: [
    {
      ...song.lyrics[0],
      id: 'line-020',
      text: {
        ja: 'どんな時もかけがえのないパートナー',
        koPronunciation: '돈나 토키모 카케가에노 나이 파-토나-',
      },
    },
    song.lyrics[1],
  ],
  callEvents: [
    {
      ...song.callEvents[0],
      id: 'call-hey-020',
      lyricLineId: 'line-020',
      anchor: { targetText: 'ja', unit: 'grapheme', pointChar: 18 },
      text: { ko: 'Hey!' },
      markers: {
        point: { enabled: true, style: 'pointArrow', direction: 'auto' },
        range: { enabled: false, style: 'none' },
      },
    },
    song.callEvents[1],
  ],
}

const leftAnchorSong = {
  ...song,
  callEvents: [
    {
      ...song.callEvents[0],
      anchor: { targetText: 'ja', unit: 'grapheme', pointChar: 1 },
      text: { ko: '왼쪽에서도 잘리지 않는 긴 콜 태그!' },
      markers: {
        point: { enabled: true, style: 'pointArrow', direction: 'auto' },
        range: { enabled: false, style: 'none' },
      },
    },
    song.callEvents[1],
  ],
}

const ppphLeftAnchorSong = {
  ...song,
  callEvents: [
    {
      ...song.callEvents[0],
      anchor: { targetText: 'ja', unit: 'grapheme', pointChar: 1 },
      text: { ko: '하이 세노! 하이! 하이! 하이하이하이하이!' },
      markers: {
        point: { enabled: true, style: 'pointArrow', direction: 'auto' },
        range: { enabled: false, style: 'none' },
      },
    },
    song.callEvents[1],
  ],
}

const overlappingKindSong = {
  ...song,
  callEvents: [
    {
      ...song.callEvents[0],
      id: 'call-overlap-penlight',
      anchor: { targetText: 'ja', unit: 'grapheme', pointChar: 3 },
      text: { ko: '펜라이트!' },
      cue: { kind: 'penlight', intensity: 'normal', repeat: 1 },
    },
    {
      ...song.callEvents[0],
      id: 'call-overlap-chant',
      anchor: { targetText: 'ja', unit: 'grapheme', pointChar: 3 },
      text: { ko: '하이!' },
      cue: { kind: 'chant', intensity: 'normal', repeat: 1 },
    },
  ],
}

const crossLaneAnchorRailSong = {
  ...song,
  lyrics: [
    {
      ...song.lyrics[0],
      text: { ja: 'Wo woo woo', koPronunciation: '워 우우 우우' },
    },
    song.lyrics[1],
  ],
  callEvents: [
    {
      ...song.callEvents[0],
      id: 'call-chant-wo-woo',
      lyricLineId: 'line-001',
      placement: { mode: 'lyricTrack', lane: 'above', align: 'charAnchor' },
      anchor: { targetText: 'ja', unit: 'grapheme', pointChar: 1, rangeStartChar: 1, rangeEndChar: 10 },
      text: { ko: '워 우우 우우' },
      cue: { kind: 'chant', intensity: 'normal', repeat: 1 },
    },
    {
      ...song.callEvents[0],
      id: 'call-penlight-wo-woo',
      lyricLineId: 'line-001',
      placement: { mode: 'lyricTrack', lane: 'below', align: 'charAnchor' },
      anchor: { targetText: 'ja', unit: 'grapheme', pointChar: 1, rangeStartChar: 1, rangeEndChar: 10 },
      text: { ko: '오른손->왼손->O->흔들기' },
      cue: { kind: 'penlight', intensity: 'normal', repeat: 1 },
    },
  ],
}

const spaceAnchorSong = {
  ...song,
  lyrics: [
    {
      ...song.lyrics[0],
      text: {
        ja: '嗚呼 日本の魂が',
        koPronunciation: '아아 닛폰 노 타마시이가',
      },
    },
    song.lyrics[1],
  ],
  callEvents: [
    {
      ...song.callEvents[0],
      anchor: { targetText: 'ja', unit: 'grapheme', pointChar: 3 },
      text: { ko: '하이!' },
      markers: {
        point: { enabled: true, style: 'pointArrow', direction: 'auto' },
        range: { enabled: false, style: 'none' },
      },
    },
    song.callEvents[1],
  ],
}

const separatedInactivePreviewSong = {
  ...song,
  callEvents: [
    {
      ...song.callEvents[0],
      id: 'call-inactive-left',
      lyricLineId: 'line-002',
      anchor: { targetText: 'ja', unit: 'grapheme', pointChar: 1 },
      text: { ko: '하이!' },
      markers: {
        point: { enabled: true, style: 'pointArrow', direction: 'auto' },
        range: { enabled: false, style: 'none' },
      },
    },
    {
      ...song.callEvents[0],
      id: 'call-inactive-right',
      lyricLineId: 'line-002',
      anchor: { targetText: 'ja', unit: 'grapheme', pointChar: 6 },
      text: { ko: '하이!' },
      markers: {
        point: { enabled: true, style: 'pointArrow', direction: 'auto' },
        range: { enabled: false, style: 'none' },
      },
    },
  ],
}

const autoFollowSong = {
  ...song,
  timing: { unit: 'ms', durationMs: 24000 },
  lyrics: [
    {
      id: 'line-001',
      time: '00:00:00,000 --> 00:00:03,000',
      startMs: 0,
      endMs: 3000,
      text: { ja: '光る一番目の歌', koPronunciation: '히카루 이치반메노 우타' },
    },
    {
      id: 'line-002',
      time: '00:00:03,000 --> 00:00:06,000',
      startMs: 3000,
      endMs: 6000,
      text: { ja: '声を重ねる二番目', koPronunciation: '코에오 카사네루 니반메' },
    },
    {
      id: 'line-003',
      time: '00:00:06,000 --> 00:00:09,000',
      startMs: 6000,
      endMs: 9000,
      text: { ja: '星へ進む三番目', koPronunciation: '호시에 스스무 산반메' },
    },
    {
      id: 'line-004',
      time: '00:00:09,000 --> 00:00:12,000',
      startMs: 9000,
      endMs: 12000,
      text: { ja: '未来へ続く四番目', koPronunciation: '미라이에 츠즈쿠 욘반메' },
    },
    {
      id: 'line-005',
      time: '00:00:12,000 --> 00:00:15,000',
      startMs: 12000,
      endMs: 15000,
      text: { ja: '夢を灯す五番目', koPronunciation: '유메오 토모스 고반메' },
    },
    {
      id: 'line-006',
      time: '00:00:15,000 --> 00:00:18,000',
      startMs: 15000,
      endMs: 18000,
      text: { ja: '君へ届く六番目', koPronunciation: '키미에 토도쿠 로쿠반메' },
    },
    {
      id: 'line-007',
      time: '00:00:18,000 --> 00:00:21,000',
      startMs: 18000,
      endMs: 21000,
      text: { ja: '空を翔ける七番目', koPronunciation: '소라오 카케루 나나반메' },
    },
    {
      id: 'line-008',
      time: '00:00:21,000 --> 00:00:24,000',
      startMs: 21000,
      endMs: 24000,
      text: { ja: '最後に響く八番目', koPronunciation: '사이고니 히비쿠 하치반메' },
    },
  ],
  callEvents: [song.callEvents[0], song.callEvents[1]],
}

const segmentedSong = {
  ...song,
  callEvents: [
    {
      id: 'call-segmented-chorus',
      placement: { mode: 'lyricTrack', lane: 'above', align: 'charAnchor' },
      text: { ko: '연속 콜!' },
      activation: { mode: 'lineActive' },
      cue: { kind: 'chant', intensity: 'high', repeat: 1 },
      segments: [
        {
          lyricLineId: 'line-001',
          part: 'start',
          anchor: { targetText: 'ja', unit: 'grapheme', pointChar: 3, rangeStartChar: 3, rangeEndChar: 5 },
          markers: {
            point: { enabled: true, style: 'pointArrow', direction: 'auto' },
            range: { enabled: true, style: 'bracket' },
          },
        },
        {
          lyricLineId: 'line-002',
          part: 'end',
          anchor: { targetText: 'ja', unit: 'grapheme', pointChar: 1, rangeStartChar: 1, rangeEndChar: 3 },
          markers: {
            point: { enabled: false, style: 'none', direction: 'auto' },
            range: { enabled: true, style: 'bracket' },
          },
        },
      ],
    },
  ],
}

let mockedSong: unknown = song

function setMockedSong(candidate: unknown): void {
  expect(validateRuntimeSong(candidate), JSON.stringify(validateRuntimeSong.errors ?? [])).toBe(true)
  mockedSong = candidate
}

test.beforeEach(async ({ page }) => {
  setMockedSong(song)
  await page.route('**/manifest.json', async (route) => {
    await route.fulfill({ json: rootManifest })
  })
  await page.route('**/call-guide-manifest.json', async (route) => {
    await route.fulfill({ json: callGuideManifest })
  })
  await page.route('**/event-calendar/index.json', async (route) => {
    await route.fulfill({ json: eventCalendarIndex })
  })
  await page.route('**/event-calendar/months/2026-05.json', async (route) => {
    await route.fulfill({ json: eventCalendarMayMonth })
  })
  await page.route('**/event-calendar/months/2026-06.json', async (route) => {
    await route.fulfill({ json: eventCalendarMonth })
  })
  await page.route('**/event-calendar/events/miku-multi-day-popup-sample.json', async (route) => {
    await route.fulfill({ json: multiDayEventDetail })
  })
  await page.route('**/event-calendar/events/second-miku-thanks-festival-2026.json', async (route) => {
    await route.fulfill({ json: dateOnlyEventDetail })
  })
  await page.route('**/event-calendar/events/miku-practice-sample.json', async (route) => {
    await route.fulfill({ json: eventDetail })
  })
  await page.route('**/api/auth/session', async (route) => {
    await route.fulfill({ json: { authenticated: false } })
  })
  await page.route('https://platform.x.com/widgets.js', async (route) => {
    await route.fulfill({
      body: 'window.twttr={widgets:{load:function(){}}};',
      contentType: 'application/javascript',
    })
  })
  await page.route('https://i.ytimg.com/**', async (route) => {
    await route.fulfill({
      body: Buffer.from('R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==', 'base64'),
      contentType: 'image/gif',
    })
  })
  await page.route('**/songs/future-light-sample.json', async (route) => {
    await route.fulfill({ json: mockedSong })
  })
})

test('renders the main catalog as a dark responsive practice surface', async ({ page }) => {
  await page.goto('/?mockPlayer=1')

  await expect(page.getByRole('heading', { name: '콜 가이드' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Catalog' }).first()).toHaveAttribute('data-active', 'true')
  await expect(page.getByRole('link', { name: 'Events' }).first()).toHaveAttribute('data-active', 'false')
  await expect(page.getByRole('button', { name: /Reload/ })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '다시 시도' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '전체' })).toHaveAttribute('data-active', 'true')
  await expect(page.locator('.app-summary-strip')).not.toContainText('Events')
  await expect(page.locator('.app-summary-strip')).not.toContainText('Open')
  const songCard = page.locator('.catalog-song-card', { hasText: '퓨처 라이트 샘플' })
  await expect(songCard).toBeVisible()
  await expect(songCard).toContainText('하츠네 미쿠 팬 샘플')
  await expect(songCard).toContainText('Practice')
  await expect(page.locator('.catalog-source-chip')).toHaveCount(0)
  await expect(page.locator('.catalog-status-pill')).toHaveCount(0)
  await expect(songCard).not.toContainText('published')
  await expect(songCard).not.toContainText('M7lc1UVf-VE')
  await expect(songCard).not.toContainText('iAU1LmhtCSw')
  const thumbnail = songCard.locator('.catalog-song-thumbnail')
  await expect(thumbnail).toHaveAttribute('src', 'https://i.ytimg.com/vi/iAU1LmhtCSw/hqdefault.jpg')
  await expect(thumbnail).toHaveAttribute('alt', '')
  await expect(thumbnail).toHaveAttribute('aria-hidden', 'true')
  await expect(thumbnail).toHaveAttribute('loading', 'lazy')

  const metrics = await page.evaluate(() => {
    const shell = document.querySelector('.catalog-shell')
    const heading = document.querySelector('.app-heading-row')
    const title = document.querySelector('#catalog-page-title')
    const summary = document.querySelector('.app-summary-strip')
    const summaryItem = document.querySelector('.app-summary-item')
    const card = document.querySelector<HTMLElement>('.catalog-song-card')
    const contentPanel = document.querySelector<HTMLElement>('.catalog-content-panel')
    const media = card?.querySelector<HTMLElement>('.catalog-song-media')
    const content = card?.querySelector<HTMLElement>('.catalog-song-content')
    const thumbnail = card?.querySelector<HTMLElement>('.catalog-song-thumbnail')
    const titleInCard = card?.querySelector<HTMLElement>('h2')
    const toolbar = document.querySelector('.app-toolbar')
    const cardStyle = card ? getComputedStyle(card) : null
    const contentPanelStyle = contentPanel ? getComputedStyle(contentPanel) : null
    const contentStyle = content ? getComputedStyle(content) : null
    const mediaRect = media?.getBoundingClientRect()
    const contentRect = content?.getBoundingClientRect()
    const mediaStyle = media ? getComputedStyle(media) : null
    const thumbnailStyle = thumbnail ? getComputedStyle(thumbnail) : null
    const thumbnailTransform = thumbnailStyle?.transform ?? 'none'
    const shellStyle = shell ? getComputedStyle(shell) : null
    const titleRect = title?.getBoundingClientRect()
    const summaryRect = summary?.getBoundingClientRect()
    const summaryItemStyle = summaryItem ? getComputedStyle(summaryItem) : null
    const toolbarRect = toolbar?.getBoundingClientRect()
    const viewportWidth = document.documentElement.clientWidth
    const overflowing = Array.from(
      document.querySelectorAll(
        '.app-top-bar-inner, .app-main, .app-heading-row, .app-summary-strip, .app-toolbar, .catalog-content-panel, .catalog-song-card, .catalog-search, .catalog-segmented',
      ),
    ).filter((element) => {
      const rect = element.getBoundingClientRect()
      return rect.left < -1 || rect.right > viewportWidth + 1 || element.scrollWidth > element.clientWidth + 1
    }).length

    return {
      background: shellStyle?.backgroundColor,
      cardBackground: cardStyle?.backgroundColor,
      cardHasOriginalArtClass: card?.classList.contains('catalog-song-card--original-art') ?? false,
      cardIsolation: cardStyle?.isolation,
      cardOverflow: cardStyle?.overflow,
      cardPosition: cardStyle?.position,
      contentZIndex: contentStyle?.zIndex,
      colorScheme: shellStyle?.colorScheme,
      contentPanelOverflowY: contentPanelStyle?.overflowY,
      contentBackgroundImage: contentStyle?.backgroundImage,
      mediaContentOverlap: mediaRect && contentRect ? mediaRect.bottom - contentRect.top : 0,
      mediaHeight: mediaRect?.height ?? 0,
      mediaOverflow: mediaStyle?.overflow,
      mediaPosition: mediaStyle?.position,
      overflowing,
      summaryDisplay: summary ? getComputedStyle(summary).display : 'missing',
      summaryBeforeToolbar: summaryRect && toolbarRect ? summaryRect.bottom <= toolbarRect.top : false,
      summaryItemPaddingTop: summaryItemStyle ? Number.parseFloat(summaryItemStyle.paddingTop) : Number.POSITIVE_INFINITY,
      summaryInHeading: summary && heading ? heading.contains(summary) : false,
      summarySharesHeadingLine:
        titleRect && summaryRect ? summaryRect.top < titleRect.bottom && summaryRect.bottom > titleRect.top : false,
      textOverflowing: [titleInCard].filter((element): element is HTMLElement => Boolean(element)).filter(
        (element) => element.scrollWidth > element.clientWidth + 1,
      ).length,
      thumbnailObjectFit: thumbnailStyle?.objectFit,
      thumbnailOpacity: thumbnailStyle ? Number.parseFloat(thumbnailStyle.opacity) : Number.POSITIVE_INFINITY,
      thumbnailPosition: thumbnailStyle?.position,
      thumbnailScale: thumbnailTransform === 'none' ? 1 : new DOMMatrixReadOnly(thumbnailTransform).a,
      viewportWidth,
    }
  })

  expect(metrics.background).toBe('rgb(9, 9, 11)')
  expect(metrics.cardBackground).toBe('rgb(17, 17, 19)')
  expect(metrics.cardHasOriginalArtClass).toBe(true)
  expect(metrics.cardIsolation).toBe('isolate')
  expect(metrics.cardOverflow).toBe('hidden')
  expect(metrics.cardPosition).toBe('relative')
  expect(metrics.contentZIndex).toBe('1')
  expect(metrics.colorScheme).toBe('dark')
  expect(metrics.contentPanelOverflowY).toBe('auto')
  expect(metrics.contentBackgroundImage).toContain('linear-gradient')
  expect(metrics.mediaContentOverlap).toBeGreaterThan(20)
  expect(metrics.mediaContentOverlap).toBeLessThan(52)
  expect(metrics.mediaHeight).toBeGreaterThan(120)
  expect(metrics.mediaOverflow).toBe('hidden')
  expect(metrics.mediaPosition).toBe('relative')
  expect(metrics.overflowing).toBe(0)
  expect(metrics.summaryInHeading).toBe(true)
  expect(metrics.summaryBeforeToolbar).toBe(true)
  expect(metrics.textOverflowing).toBe(0)
  expect(metrics.thumbnailObjectFit).toBe('cover')
  expect(metrics.thumbnailOpacity).toBeGreaterThan(0.75)
  expect(metrics.thumbnailOpacity).toBeLessThanOrEqual(1)
  expect(metrics.thumbnailPosition).toBe('absolute')
  expect(metrics.thumbnailScale).toBeGreaterThan(1.3)
  expect(metrics.thumbnailScale).toBeLessThan(1.45)
  if (metrics.viewportWidth <= 760) {
    expect(metrics.summaryDisplay).toBe('none')
  } else {
    expect(metrics.summarySharesHeadingLine).toBe(true)
    expect(metrics.summaryItemPaddingTop).toBeGreaterThan(4)
  }
})

test('shows catalog retry only when the initial manifest request fails', async ({ page }) => {
  await page.unroute('**/manifest.json')
  let shouldFail = true
  await page.route('**/manifest.json', async (route) => {
    if (shouldFail) {
      await route.fulfill({ status: 500, body: 'manifest unavailable' })
      return
    }

    await route.fulfill({ json: rootManifest })
  })

  await page.goto('/?mockPlayer=1')

  await expect(page.getByRole('alert')).toContainText('Request failed with 500.')
  await expect(page.getByRole('button', { name: '다시 시도' })).toBeVisible()
  await expect(page.getByRole('button', { name: /Reload/ })).toHaveCount(0)

  shouldFail = false
  await page.getByRole('button', { name: '다시 시도' }).click()

  await expect(page.getByRole('alert')).toHaveCount(0)
  await expect(page.getByRole('button', { name: '다시 시도' })).toHaveCount(0)
  await expect(page.locator('.catalog-song-card', { hasText: '퓨처 라이트 샘플' })).toBeVisible()
})

test('shows catalog retry when cached manifest data is being used', async ({ page }) => {
  await page.unroute('**/manifest.json')
  let shouldFail = false
  await page.route('**/manifest.json', async (route) => {
    if (shouldFail) {
      await route.fulfill({ status: 500, body: 'manifest unavailable' })
      return
    }

    await route.fulfill({ json: rootManifest })
  })

  await page.goto('/?mockPlayer=1')
  await expect(page.locator('.catalog-song-card', { hasText: '퓨처 라이트 샘플' })).toBeVisible()

  shouldFail = true
  await page.reload()

  await expect(page.locator('.app-status-banner')).toContainText('캐시를 사용 중입니다.')
  await expect(page.getByRole('button', { name: '다시 시도' })).toBeVisible()
  await expect(page.locator('.catalog-song-card', { hasText: '퓨처 라이트 샘플' })).toBeVisible()

  shouldFail = false
  await page.getByRole('button', { name: '다시 시도' }).click()

  await expect(page.locator('.app-status-banner')).toHaveCount(0)
  await expect(page.getByRole('button', { name: '다시 시도' })).toHaveCount(0)
})

test('opens the event calendar from the dark catalog', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-05-21T12:00:00+09:00'))
  await page.goto('/?mockPlayer=1')

  await page.getByRole('link', { name: 'Events' }).first().click()

  await expect(page.getByRole('heading', { name: 'Event Calendar' })).toBeVisible()
  await expect(page.locator('.event-month-controls')).toContainText('2026년 5월')
  const addEventButton = page.getByRole('button', { name: '일정 추가' })
  await expect(addEventButton).toHaveClass(/event-add-compact-button/)
  const addEventButtonMetrics = await page.evaluate(() => {
    const button = document.querySelector<HTMLElement>('.event-add-compact-button')
    return button
      ? {
          height: button.getBoundingClientRect().height,
          inTopBar: Boolean(button.closest('.app-top-bar')),
          inToolbar: Boolean(button.closest('.app-toolbar')),
        }
      : null
  })
  expect(addEventButtonMetrics).not.toBeNull()
  expect(addEventButtonMetrics!.inTopBar).toBe(false)
  expect(addEventButtonMetrics!.inToolbar).toBe(true)
  expect(addEventButtonMetrics!.height).toBeLessThan(36)
  await expect(page.locator('.event-day-cell[data-today="true"] .event-day-number')).toHaveText('21')
  await expect(page.locator('.event-detail-panel')).toHaveAttribute('data-open', 'false')
  if ((page.viewportSize()?.width ?? 0) > 980) {
    await expect(page.locator('.event-detail-panel')).not.toBeVisible()
  }
  await expect(page.locator('.event-type-filters button').nth(1)).toHaveText('Popup')
  await expect(page.locator('.event-type-filters button').nth(2)).toHaveText('Concert')
  await expect(page.locator('.event-weekdays span').first()).toHaveAttribute('data-day-kind', 'sunday')
  await expect(page.locator('.event-weekdays span').nth(1)).toHaveAttribute('data-day-kind', 'weekday')
  await expect(page.locator('.event-weekdays span').last()).toHaveAttribute('data-day-kind', 'saturday')
  const dayKindMetrics = await page.evaluate(() => {
    const sundayCell = document.querySelector<HTMLElement>('.event-day-cell[data-day-kind="sunday"]')
    const weekdayCell = document.querySelector<HTMLElement>('.event-day-cell[data-day-kind="weekday"]')
    const saturdayCell = document.querySelector<HTMLElement>('.event-day-cell[data-day-kind="saturday"]')
    const sundayNumber = sundayCell?.querySelector<HTMLElement>('.event-day-number')
    const weekdayNumber = weekdayCell?.querySelector<HTMLElement>('.event-day-number')
    const saturdayNumber = saturdayCell?.querySelector<HTMLElement>('.event-day-number')

    return {
      saturdayBackgroundColor: saturdayCell ? window.getComputedStyle(saturdayCell).backgroundColor : '',
      saturdayBackgroundImage: saturdayCell ? window.getComputedStyle(saturdayCell).backgroundImage : '',
      saturdayNumberColor: saturdayNumber ? window.getComputedStyle(saturdayNumber).color : '',
      sundayBackgroundColor: sundayCell ? window.getComputedStyle(sundayCell).backgroundColor : '',
      sundayBackgroundImage: sundayCell ? window.getComputedStyle(sundayCell).backgroundImage : '',
      sundayNumberColor: sundayNumber ? window.getComputedStyle(sundayNumber).color : '',
      weekdayBackgroundColor: weekdayCell ? window.getComputedStyle(weekdayCell).backgroundColor : '',
      weekdayBackgroundImage: weekdayCell ? window.getComputedStyle(weekdayCell).backgroundImage : '',
      weekdayNumberColor: weekdayNumber ? window.getComputedStyle(weekdayNumber).color : '',
    }
  })
  expect(dayKindMetrics.sundayBackgroundImage).toBe(dayKindMetrics.weekdayBackgroundImage)
  expect(dayKindMetrics.saturdayBackgroundImage).toBe(dayKindMetrics.weekdayBackgroundImage)
  expect(dayKindMetrics.sundayBackgroundColor).toBe(dayKindMetrics.weekdayBackgroundColor)
  expect(dayKindMetrics.saturdayBackgroundColor).toBe(dayKindMetrics.weekdayBackgroundColor)
  expect(dayKindMetrics.sundayNumberColor).not.toBe(dayKindMetrics.weekdayNumberColor)
  expect(dayKindMetrics.saturdayNumberColor).not.toBe(dayKindMetrics.weekdayNumberColor)
  const pageLayoutMetrics = await page.evaluate(() => {
    const calendarPanel = document.querySelector<HTMLElement>('.event-calendar-panel')
    const dayCell = document.querySelector<HTMLElement>('.event-day-cell')
    const calendarRect = calendarPanel?.getBoundingClientRect()
    const dayRect = dayCell?.getBoundingClientRect()
    return {
      calendarClientWidth: calendarPanel?.clientWidth ?? 0,
      calendarPanelHeight: calendarRect?.height ?? 0,
      calendarScrollableX: calendarPanel ? calendarPanel.scrollWidth > calendarPanel.clientWidth + 1 : false,
      calendarScrollableY: calendarPanel ? calendarPanel.scrollHeight > calendarPanel.clientHeight + 1 : false,
      calendarScrollWidth: calendarPanel?.scrollWidth ?? 0,
      dayCellHeight: dayRect?.height ?? 0,
      documentScrollable: (document.scrollingElement?.scrollHeight ?? 0) > window.innerHeight + 1,
      viewportHeight: window.innerHeight,
    }
  })

  expect(pageLayoutMetrics.documentScrollable).toBe(false)
  if ((page.viewportSize()?.width ?? 0) <= 620) {
    expect(pageLayoutMetrics.calendarScrollableX).toBe(false)
    expect(pageLayoutMetrics.calendarScrollableY).toBe(false)
    expect(pageLayoutMetrics.calendarPanelHeight / pageLayoutMetrics.viewportHeight).toBeGreaterThan(0.56)
    expect(pageLayoutMetrics.dayCellHeight).toBeGreaterThan(56)
    await expect(page.locator('.event-calendar-panel')).toHaveAttribute('data-scrollable', 'false')
  }
  if (pageLayoutMetrics.calendarScrollableX) {
    await expect(page.locator('.event-calendar-panel')).toHaveAttribute('data-scrollable', 'true')
    const calendarBox = await page.locator('.event-calendar-panel').boundingBox()
    expect(calendarBox).not.toBeNull()
    await page.mouse.move(calendarBox!.x + calendarBox!.width - 24, calendarBox!.y + calendarBox!.height / 2)
    await page.mouse.down()
    await page.mouse.move(calendarBox!.x + 24, calendarBox!.y + calendarBox!.height / 2, { steps: 6 })
    await page.mouse.up()

    const draggedScrollLeft = await page.locator('.event-calendar-panel').evaluate((element) => element.scrollLeft)
    expect(draggedScrollLeft).toBeGreaterThan(0)
    await page.waitForTimeout(20)
  }

  await expect(page.locator('.event-span-bar', { hasText: '하츠네 미쿠 다일 팝업 샘플' })).toHaveCount(3)
  await expect(page.locator('.event-chip', { hasText: '하츠네 미쿠 다일 팝업 샘플' })).toHaveCount(0)
  const mayTickerHeights = await page.locator('.event-calendar-panel .event-span-bar').evaluateAll((items) =>
    items.map((item) => item.getBoundingClientRect().height),
  )
  expect(Math.max(...mayTickerHeights) - Math.min(...mayTickerHeights)).toBeLessThanOrEqual(1)
  const compactLaneMetrics = await page.evaluate(() => {
    const middle = document.querySelector<HTMLElement>('.event-span-bar[data-occurrence-id="middle-period"]')
    const reuse = document.querySelector<HTMLElement>('.event-span-bar[data-occurrence-id="reuse-day"]')
    const upper = document.querySelector<HTMLElement>('.event-span-bar[data-occurrence-id="upper-period"]')

    return middle && reuse && upper
      ? {
          middleLane: middle.style.getPropertyValue('--event-bar-lane').trim(),
          reuseLane: reuse.style.getPropertyValue('--event-bar-lane').trim(),
          upperLane: upper.style.getPropertyValue('--event-bar-lane').trim(),
          middleTop: middle.getBoundingClientRect().top,
          reuseTop: reuse.getBoundingClientRect().top,
          upperTop: upper.getBoundingClientRect().top,
        }
      : null
  })
  expect(compactLaneMetrics).not.toBeNull()
  expect(compactLaneMetrics!.middleLane).toBe('1')
  expect(compactLaneMetrics!.reuseLane).toBe('1')
  expect(compactLaneMetrics!.upperLane).toBe('2')
  expect(Math.abs(compactLaneMetrics!.middleTop - compactLaneMetrics!.reuseTop)).toBeLessThanOrEqual(1)
  expect(compactLaneMetrics!.reuseTop).toBeLessThan(compactLaneMetrics!.upperTop)

  const multiDayMetrics = await page.evaluate(() => {
    const bar = document.querySelector<HTMLElement>('.event-span-bar[data-occurrence-id="opening-period"]')
    const dayCell = document.querySelector<HTMLElement>('.event-day-cell')
    const barRect = bar?.getBoundingClientRect()
    const dayRect = dayCell?.getBoundingClientRect()
    const barStyle = bar ? window.getComputedStyle(bar) : null

    return barRect && dayRect && barStyle
      ? {
          barBorderRadius: Number.parseFloat(barStyle.borderRadius),
          barBoxShadow: barStyle.boxShadow,
          barFontSize: Number.parseFloat(barStyle.fontSize),
          barHeight: barRect.height,
          barPaddingLeft: Number.parseFloat(barStyle.paddingLeft),
          barWidth: barRect.width,
          dayWidth: dayRect.width,
        }
      : null
  })

  expect(multiDayMetrics).not.toBeNull()
  expect(multiDayMetrics!.barWidth).toBeGreaterThan(multiDayMetrics!.dayWidth * 2)

  const openingBar = page.locator('.event-span-bar[data-occurrence-id="opening-period"]')
  await openingBar.evaluate((bar) => {
    const panel = bar.closest<HTMLElement>('.event-calendar-panel')
    if (!panel) {
      return
    }

    panel.scrollLeft = Math.max(0, (bar as HTMLElement).offsetLeft - panel.clientWidth / 2)
    const barRect = bar.getBoundingClientRect()
    const panelRect = panel.getBoundingClientRect()
    if (barRect.bottom > panelRect.bottom) {
      panel.scrollTop += barRect.bottom - panelRect.bottom + 8
    } else if (barRect.top < panelRect.top) {
      panel.scrollTop -= panelRect.top - barRect.top + 8
    }
  })
  const openingBarBox = await openingBar.boundingBox()
  expect(openingBarBox).not.toBeNull()
  if ((page.viewportSize()?.width ?? 0) > 980) {
    await openingBar.click()
  } else {
    await openingBar.evaluate((bar) => {
      ;(bar as HTMLButtonElement).click()
    })
  }
  const multiDayDetailCard = page.locator('.event-detail-card', { hasText: '하츠네 미쿠 다일 팝업 샘플' })
  await expect(multiDayDetailCard).toBeVisible()
  await expect(multiDayDetailCard).toContainText('오전 10:00 - 오후 08:00')
  await expect(multiDayDetailCard.locator('.event-x-embed')).toBeVisible()

  if ((page.viewportSize()?.width ?? 0) > 980) {
    const detailPanel = page.locator('.event-detail-panel')
    await expect(detailPanel).toHaveAttribute('data-expanded', 'true')
    const expandedPanelBox = await detailPanel.boundingBox()
    expect(expandedPanelBox).not.toBeNull()
    expect(expandedPanelBox!.width).toBeGreaterThan(440)
    await page.getByRole('button', { name: '상세 축소' }).click()
    await expect(detailPanel).toHaveAttribute('data-expanded', 'false')
    await expect(detailPanel).not.toBeVisible()
  }

  if ((page.viewportSize()?.width ?? 0) <= 980) {
    const dismissHandle = page.getByRole('button', { name: '상세 닫기' })
    await expect(dismissHandle).toBeVisible()
    const handleBox = await dismissHandle.boundingBox()
    expect(handleBox).not.toBeNull()
    await dismissHandle.evaluate((handle) => {
      const rect = handle.getBoundingClientRect()
      const x = rect.left + rect.width / 2
      const y = rect.top + rect.height / 2
      handle.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, cancelable: true, clientX: x, clientY: y }))
      window.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, button: 0, cancelable: true, clientX: x, clientY: y + 110 }))
      window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0, cancelable: true, clientX: x, clientY: y + 110 }))
    })
    await expect(page.locator('.event-detail-panel')).toHaveAttribute('data-open', 'false')
  }

  await page.getByRole('button', { name: 'Next month' }).click()
  const dateOnlyBar = page.locator('.event-span-bar[data-occurrence-id="date-only-period"]').first()
  await expect(dateOnlyBar).toBeVisible()
  if ((page.viewportSize()?.width ?? 0) > 980) {
    await dateOnlyBar.click()
  } else {
    await dateOnlyBar.evaluate((bar) => {
      ;(bar as HTMLButtonElement).click()
    })
  }
  const dateOnlyDetailCard = page.locator('.event-detail-card', { hasText: '제2회 미쿠감사제: 우리들의 즐거운 시간' })
  await expect(dateOnlyDetailCard).toBeVisible()
  await expect(dateOnlyDetailCard.locator('.event-detail-time')).toHaveCount(0)
  if ((page.viewportSize()?.width ?? 0) <= 980) {
    const dismissHandle = page.getByRole('button', { name: '상세 닫기' })
    await dismissHandle.evaluate((handle) => {
      const rect = handle.getBoundingClientRect()
      const x = rect.left + rect.width / 2
      const y = rect.top + rect.height / 2
      handle.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, cancelable: true, clientX: x, clientY: y }))
      window.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, button: 0, cancelable: true, clientX: x, clientY: y + 110 }))
      window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0, cancelable: true, clientX: x, clientY: y + 110 }))
    })
    await expect(page.locator('.event-detail-panel')).toHaveAttribute('data-open', 'false')
  }
  const junePracticeBar = page.locator('.event-span-bar[data-occurrence-id="day-1"]', { hasText: '하츠네 미쿠 예습 샘플' })
  await expect(junePracticeBar).toBeVisible()
  const juneTickerHeights = await page
    .locator('.event-calendar-panel .event-span-bar, .event-calendar-panel .event-chip, .event-calendar-panel .event-more-chip')
    .evaluateAll((items) => items.map((item) => item.getBoundingClientRect().height))
  expect(Math.max(...juneTickerHeights) - Math.min(...juneTickerHeights)).toBeLessThanOrEqual(1)

  const juneChipMetrics = await junePracticeBar.evaluate((chip) => {
    const rect = chip.getBoundingClientRect()
    const style = window.getComputedStyle(chip)
    return {
      borderRadius: Number.parseFloat(style.borderRadius),
      fontSize: Number.parseFloat(style.fontSize),
      height: rect.height,
      marginBottom: Number.parseFloat(style.marginBottom),
      marginTop: Number.parseFloat(style.marginTop),
      paddingLeft: Number.parseFloat(style.paddingLeft),
      text: chip.textContent,
    }
  })
  expect(juneChipMetrics.text).toContain('하츠네 미쿠 예습 샘플')
  expect(multiDayMetrics!.barBorderRadius).toBe(juneChipMetrics.borderRadius)
  expect(multiDayMetrics!.barBoxShadow).toBe('none')
  expect(Math.abs(multiDayMetrics!.barHeight - juneChipMetrics.height)).toBeLessThanOrEqual(1)
  expect(multiDayMetrics!.barFontSize).toBe(juneChipMetrics.fontSize)
  expect(multiDayMetrics!.barPaddingLeft).toBe(juneChipMetrics.paddingLeft)
  if ((page.viewportSize()?.width ?? 0) <= 620) {
    expect(juneChipMetrics.borderRadius).toBeLessThanOrEqual(4)
    expect(juneChipMetrics.paddingLeft).toBeLessThanOrEqual(3)
    expect(juneChipMetrics.marginTop).toBe(0)
    expect(juneChipMetrics.marginBottom).toBe(0)
  }
  expect(juneChipMetrics.fontSize).toBeGreaterThan(0)
  expect(juneChipMetrics.height).toBeGreaterThan(0)
  await junePracticeBar.evaluate((bar) => {
    const panel = bar.closest<HTMLElement>('.event-calendar-panel')
    if (!panel) {
      return
    }

    const cellRect = bar.getBoundingClientRect()
    const panelRect = panel.getBoundingClientRect()
    if (cellRect.bottom > panelRect.bottom) {
      panel.scrollTop += cellRect.bottom - panelRect.bottom + 8
    } else if (cellRect.top < panelRect.top) {
      panel.scrollTop -= panelRect.top - cellRect.top + 8
    }
  })
  if ((page.viewportSize()?.width ?? 0) > 980) {
    await junePracticeBar.click()
  } else {
    await junePracticeBar.evaluate((bar) => {
      ;(bar as HTMLButtonElement).click()
    })
  }
  const detailCard = page.locator('.event-detail-card', { hasText: '하츠네 미쿠 예습 샘플' })
  await expect(detailCard).toBeVisible()
  await expect(detailCard.locator('.event-x-embed')).toBeVisible()
  await expect(detailCard.locator('.event-x-embed .twitter-tweet a')).toHaveAttribute('href', 'https://x.com/example/status/123')
  await expect(detailCard.locator('.event-link-row').getByRole('link', { name: 'X' })).toHaveAttribute(
    'href',
    'https://x.com/example/status/123',
  )
})

test('renders the mock player and places an above call marker over the lyric line', async ({ page }) => {
  await page.goto('/?mockPlayer=1#/songs/future-light-sample')

  await expect(page.getByRole('heading', { name: '퓨처 라이트 샘플' })).toBeVisible()
  await expect(page.getByTestId('mock-player')).toBeVisible()
  await expect(page.locator('.lyric-original:not(.lyric-original-measure)', { hasText: '光るステージへ' })).toBeVisible()
  await expect(page.getByText('하이! 하이!')).toBeVisible()
  await expect(page.locator('.call-marker[data-variant="preview"]', { hasText: '오-!' })).toBeVisible()
  await expect(page.locator('.call-range-end-arrow')).toBeVisible()

  const callBox = await page.locator('.call-marker-text', { hasText: '하이! 하이!' }).boundingBox()
  const lyricBox = await page.locator('.lyric-original[aria-label="光るステージへ"]').boundingBox()
  expect(callBox).not.toBeNull()
  expect(lyricBox).not.toBeNull()
  expect(callBox!.y).toBeLessThan(lyricBox!.y)

  const videoBox = await page.locator('.video-frame').boundingBox()
  const lyricListBox = await page.locator('.lyric-list').boundingBox()
  expect(videoBox).not.toBeNull()
  expect(lyricListBox).not.toBeNull()
  expect(videoBox!.height).toBeGreaterThan(120)
  expect(lyricListBox!.height).toBeGreaterThan(120)

  const palette = await page.evaluate(() => {
    const shell = document.querySelector('.player-shell')
    const topBar = document.querySelector('.player-top-bar')
    const lyricsPanel = document.querySelector('.live-lyrics-panel')

    return shell && topBar && lyricsPanel
      ? {
          shellBackground: getComputedStyle(shell).backgroundColor,
          shellImage: getComputedStyle(shell).backgroundImage,
          topBarBackground: getComputedStyle(topBar).backgroundColor,
          lyricsBackground: getComputedStyle(lyricsPanel).backgroundColor,
        }
      : null
  })

  expect(palette).not.toBeNull()
  expect(palette!.shellBackground).toBe('rgb(9, 9, 11)')
  expect(palette!.shellImage).not.toContain('0, 146, 155')
  expect(palette!.shellImage).not.toContain('4, 26, 28')
  expect(palette!.topBarBackground).toBe('rgba(9, 9, 11, 0.92)')
  expect(['rgba(17, 17, 19, 0.88)', 'rgb(9, 9, 11)', 'rgba(0, 0, 0, 0)']).toContain(palette!.lyricsBackground)
})

test('renders a compact legend for the call kinds used in the song', async ({ page }) => {
  await page.goto('/?mockPlayer=1#/songs/future-light-sample')

  const legend = page.locator('.call-kind-legend')
  await expect(legend).toBeVisible()
  await expect(legend.locator('.call-kind-legend-item[data-kind="chant"]')).toHaveText('Voice')
  await expect(legend.locator('.call-kind-legend-item[data-kind="penlight"]')).toHaveText('Penlight')
  await expect(legend.locator('.call-kind-legend-item[data-kind="custom"]')).toHaveCount(0)
})

test('moves the active lyric into the current position as playback advances', async ({ page }) => {
  await page.goto('/?mockPlayer=1#/songs/future-light-sample')

  await expect(page.getByText('하이! 하이!')).toBeVisible()
  await page.getByRole('button', { name: '+6s' }).click()

  const activeLyric = page.locator('.lyric-line[data-position="current"]')
  await expect(activeLyric.getByLabel('声を重ねよう')).toBeVisible()
  await expect(activeLyric.locator('.call-marker', { hasText: '오-!' })).toBeVisible()
  await expect(page.locator('.call-marker[data-variant="preview"]', { hasText: '하이! 하이!' })).toBeVisible()
})

test('stacks overlapping call kinds as separate colored marker rows', async ({ page }) => {
  setMockedSong(overlappingKindSong)

  await page.goto('/?mockPlayer=1#/songs/future-light-sample')

  const activeLine = page.locator('.lyric-line[data-position="current"]')
  await expect(activeLine.locator('.call-marker[data-kind="chant"]', { hasText: '하이!' })).toBeVisible()
  await expect(activeLine.locator('.call-marker[data-kind="penlight"]', { hasText: '펜라이트!' })).toBeVisible()

  const metrics = await activeLine.evaluate((line) => {
    const markers = Array.from(line.querySelectorAll<HTMLElement>('.call-marker[data-variant="active"]')).map((marker) => {
      const rect = marker.getBoundingClientRect()
      const chip = marker.querySelector<HTMLElement>('.call-marker-text')
      return {
        kind: marker.dataset.kind,
        top: rect.top,
        background: chip ? getComputedStyle(chip).backgroundColor : '',
      }
    })

    return markers
  })

  expect(metrics.map((marker) => marker.kind)).toEqual(['chant', 'penlight'])
  expect(metrics[0].top).not.toBe(metrics[1].top)
  expect(metrics[0].background).not.toBe(metrics[1].background)
})

test('keeps cross-lane call anchor rails from covering lyrics or pronunciation', async ({ page }) => {
  setMockedSong(crossLaneAnchorRailSong)

  await page.goto('/?mockPlayer=1#/songs/future-light-sample')

  const activeLine = page.locator('.lyric-line[data-position="current"]')
  await expect(activeLine.getByLabel('Wo woo woo')).toBeVisible()
  await expect(activeLine.locator('.call-marker[data-kind="chant"][data-lane="above"]', { hasText: '워 우우 우우' })).toBeVisible()
  await expect(activeLine.locator('.call-marker[data-kind="penlight"][data-lane="below"]', { hasText: '오른손->왼손->O->흔들기' })).toBeVisible()

  const metrics = await activeLine.evaluate((line) => {
    const lyric = line.querySelector<HTMLElement>('.lyric-original')
    const pronunciation = line.querySelector<HTMLElement>('.lyric-pronunciation')
    const blockers = Array.from(line.querySelectorAll<HTMLElement>('.call-marker-text, .call-range, .call-range-end-arrow'))

    const intersects = (a: DOMRect, b: DOMRect, clearance = 0) =>
      a.left < b.right - clearance &&
      a.right > b.left + clearance &&
      a.top < b.bottom - clearance &&
      a.bottom > b.top + clearance

    const lyricRect = lyric?.getBoundingClientRect()
    const pronunciationRect = pronunciation?.getBoundingClientRect()
    const blockerRects = blockers.map((element) => ({
      className: element.className,
      text: element.textContent,
      kind: element.dataset.kind,
      lane: element.dataset.lane,
      rect: element.getBoundingClientRect(),
    }))

    return lyricRect && pronunciationRect
      ? {
          lyricBlocked: blockerRects.filter((item) => intersects(item.rect, lyricRect, 2)),
          pronunciationBlocked: blockerRects.filter((item) => intersects(item.rect, pronunciationRect, 2)),
          overflowing: blockerRects.filter((item) => {
            const panelRect = line.closest('.live-lyrics-panel')?.getBoundingClientRect()
            return panelRect ? item.rect.left < panelRect.left - 1 || item.rect.right > panelRect.right + 1 : false
          }),
        }
      : null
  })

  expect(metrics).not.toBeNull()
  expect(metrics!.lyricBlocked).toEqual([])
  expect(metrics!.pronunciationBlocked).toEqual([])
  expect(metrics!.overflowing).toEqual([])
})

test('seeks the mock player when a lyric line is clicked', async ({ page }) => {
  await page.goto('/?mockPlayer=1#/songs/future-light-sample')

  await page.getByRole('button', { name: /声を重ねよう/ }).click()

  await expect(page.getByText('0:06.0').first()).toBeVisible()
  await expect(page.locator('.lyric-line[data-position="current"]').getByLabel('声を重ねよう')).toBeVisible()
})

test('shows and clears the current lyric follow button after manual lyric scrolling', async ({ page }) => {
  await page.goto('/?mockPlayer=1#/songs/future-light-sample')

  await page.locator('.lyric-list').hover()
  await page.mouse.wheel(0, 120)
  const followButton = page.getByRole('button', { name: '현재 가사' })

  await expect(followButton).toBeVisible()
  await followButton.click()
  await expect(followButton).toHaveCount(0)
})

test('restores lyric follow mode when a lyric line is clicked after manual scrolling', async ({ page }) => {
  await page.goto('/?mockPlayer=1#/songs/future-light-sample')

  await page.locator('.lyric-list').hover()
  await page.mouse.wheel(0, 120)
  const followButton = page.getByRole('button', { name: '현재 가사' })

  await expect(followButton).toBeVisible()
  await page.getByRole('button', { name: /声を重ねよう/ }).click()

  await expect(page.getByText('0:06.0').first()).toBeVisible()
  await expect(followButton).toHaveCount(0)
})

test('keeps long active lyrics inside the lyric panel', async ({ page }) => {
  setMockedSong(longLyricSong)

  await page.goto('/?mockPlayer=1#/songs/future-light-sample')
  await expect(page.getByText('키라리토 카가야쿠')).toBeVisible()

  const overflowCount = await page.evaluate(() => {
    const panel = document.querySelector('.live-lyrics-panel')?.getBoundingClientRect()
    return Array.from(document.querySelectorAll('.lyric-line, .lyric-original, .lyric-pronunciation, .call-marker-text')).filter((element) => {
      const rect = element.getBoundingClientRect()
      const hasScrollOverflow = element.scrollWidth > element.clientWidth + 1
      const hasRectOverflow = panel ? rect.right > panel.right + 1 : false
      return hasScrollOverflow || hasRectOverflow
    }).length
  })

  expect(overflowCount).toBe(0)
})

test('keeps lyric words from breaking into character-level flex wraps', async ({ page }) => {
  setMockedSong(wordWrapSong)
  await page.setViewportSize({ width: 390, height: 820 })

  await page.goto('/?mockPlayer=1#/songs/future-light-sample')
  await expect(page.locator('.lyric-original:not(.lyric-original-measure)', { hasText: 'METEOR Future Light' })).toBeVisible()

  const metrics = await page.evaluate(() => {
    const lyric = document.querySelector('.lyric-original[aria-label="METEOR Future Light"]')
    const token = Array.from(lyric?.querySelectorAll<HTMLElement>('.lyric-token') ?? []).find((element) =>
      element.textContent?.startsWith('METEOR'),
    )
    const tokenTops = Array.from(token?.querySelectorAll<HTMLElement>('.grapheme') ?? [])
      .filter((element) => element.textContent?.trim())
      .map((element) => Math.round(element.getBoundingClientRect().top))

    return {
      directGraphemeCount: lyric?.querySelectorAll(':scope > .grapheme').length ?? -1,
      tokenCount: lyric?.querySelectorAll('.lyric-token').length ?? -1,
      uniqueTokenTops: new Set(tokenTops).size,
    }
  })

  expect(metrics.directGraphemeCount).toBe(0)
  expect(metrics.tokenCount).toBeGreaterThan(1)
  expect(metrics.uniqueTokenTops).toBe(1)
})

test('keeps wrapped call range markers out of lyric glyph bounds', async ({ page }) => {
  setMockedSong(wrappedRangeSong)

  await page.goto('/?mockPlayer=1#/songs/future-light-sample')
  await expect(page.getByText('하이 세노!')).toBeVisible()
  await expect(page.locator('.call-range-end-arrow')).toBeVisible()

  const overlapCount = await page.evaluate(() => {
    const activeLine = document.querySelector('.lyric-line[data-active="true"]')
    if (!activeLine) {
      return -1
    }

    const markers = Array.from(activeLine.querySelectorAll('.call-range, .call-range-end-arrow'))
    const graphemes = Array.from(activeLine.querySelectorAll('.grapheme')).filter(
      (grapheme) => grapheme.getBoundingClientRect().height > 1,
    )

    return markers.reduce((count, marker) => {
      const markerRect = marker.getBoundingClientRect()
      const overlapsGlyph = graphemes.some((grapheme) => {
        const glyphRect = grapheme.getBoundingClientRect()
        return (
          markerRect.left < glyphRect.right - 1 &&
          markerRect.right > glyphRect.left + 1 &&
          markerRect.top < glyphRect.bottom - 30 &&
          markerRect.bottom > glyphRect.top + 30
        )
      })

      return count + (overlapsGlyph ? 1 : 0)
    }, 0)
  })

  expect(await page.locator('.call-range').count()).toBeGreaterThan(1)
  expect(overlapCount).toBe(0)
})

test('anchors a pointChar after the final grapheme to the wrapped lyric end', async ({ page }) => {
  setMockedSong(endAnchorSong)

  await page.goto('/?mockPlayer=1#/songs/future-light-sample')
  await expect(page.getByText('끝점 콜!')).toBeVisible()

  const metrics = await page.evaluate(() => {
    const activeLine = document.querySelector('.lyric-line[data-active="true"]')
    const arrow = activeLine?.querySelector('.call-arrow')
    const graphemes = Array.from(activeLine?.querySelectorAll('.grapheme') ?? []).filter(
      (grapheme) => grapheme.getBoundingClientRect().height > 1,
    )
    const first = graphemes[0]?.getBoundingClientRect()
    const last = graphemes.at(-1)?.getBoundingClientRect()
    const arrowRect = arrow?.getBoundingClientRect()

    return first && last && arrowRect
      ? {
          firstBottom: first.bottom,
          firstTop: first.top,
          lastRight: last.right,
          lastTop: last.top,
          arrowBottom: arrowRect.bottom,
          arrowCenterX: arrowRect.left + arrowRect.width / 2,
          arrowTop: arrowRect.top,
        }
      : null
  })

  expect(metrics).not.toBeNull()
  expect(metrics!.lastTop).toBeGreaterThan(metrics!.firstTop + 8)
  expect(Math.abs(metrics!.arrowCenterX - metrics!.lastRight)).toBeLessThan(15)
  expect(metrics!.arrowTop).toBeGreaterThan(metrics!.firstBottom - 4)
  expect(metrics!.arrowBottom).toBeLessThanOrEqual(metrics!.lastTop + 8)
})

test('keeps an attakaito wrapped end anchor on the second visual lyric line', async ({ page }) => {
  setMockedSong(attakaitoWrappedEndAnchorSong)

  await page.goto('/?mockPlayer=1#/songs/future-light-sample')
  await expect(page.getByText('Hey!')).toBeVisible()

  const metrics = await page.evaluate(() => {
    const activeLine = document.querySelector('.lyric-line[data-active="true"]')
    const arrow = activeLine?.querySelector('.call-arrow')
    const marker = activeLine?.querySelector('.call-marker-text')
    const graphemes = Array.from(activeLine?.querySelectorAll('.grapheme') ?? [])
      .map((grapheme) => ({ element: grapheme, rect: grapheme.getBoundingClientRect() }))
      .filter(({ rect }) => rect.height > 1)
    const first = graphemes[0]?.rect
    const last = graphemes.at(-1)?.rect
    const arrowRect = arrow?.getBoundingClientRect()
    const markerRect = marker?.getBoundingClientRect()

    return first && last && arrowRect && markerRect
      ? {
          firstBottom: first.bottom,
          firstTop: first.top,
          lastRight: last.right,
          lastTop: last.top,
          arrowBottom: arrowRect.bottom,
          arrowCenterX: arrowRect.left + arrowRect.width / 2,
          arrowTop: arrowRect.top,
          markerBottom: markerRect.bottom,
          markerCenterX: markerRect.left + markerRect.width / 2,
          markerTop: markerRect.top,
        }
      : null
  })

  expect(metrics).not.toBeNull()
  expect(metrics!.lastTop).toBeGreaterThan(metrics!.firstTop + 8)
  expect(Math.abs(metrics!.arrowCenterX - metrics!.lastRight)).toBeLessThan(14)
  expect(metrics!.arrowTop).toBeGreaterThan(metrics!.firstBottom - 4)
  expect(metrics!.arrowBottom).toBeLessThanOrEqual(metrics!.lastTop + 8)
  expect(Math.abs(metrics!.markerCenterX - metrics!.arrowCenterX)).toBeLessThan(14)
  expect(metrics!.markerBottom).toBeLessThanOrEqual(metrics!.arrowTop + 2)
  expect(metrics!.markerTop).toBeGreaterThan(metrics!.firstTop - 4)
})

test('keeps a left-anchored call marker inside the lyric lane', async ({ page }) => {
  setMockedSong(leftAnchorSong)

  await page.goto('/?mockPlayer=1#/songs/future-light-sample')
  await expect(page.getByText('왼쪽에서도 잘리지 않는')).toBeVisible()

  const metrics = await page.evaluate(() => {
    const activeLine = document.querySelector('.lyric-line[data-active="true"]')
    const lane = activeLine?.querySelector('.call-lane')
    const marker = activeLine?.querySelector('.call-marker-text')
    const laneRect = lane?.getBoundingClientRect()
    const markerRect = marker?.getBoundingClientRect()

    return laneRect && markerRect
      ? {
          laneLeft: laneRect.left,
          laneRight: laneRect.right,
          markerLeft: markerRect.left,
          markerRight: markerRect.right,
        }
      : null
  })

  expect(metrics).not.toBeNull()
  expect(metrics!.markerLeft).toBeGreaterThanOrEqual(metrics!.laneLeft - 1)
  expect(metrics!.markerRight).toBeLessThanOrEqual(metrics!.laneRight + 1)
})

test('keeps a left-anchored PPPH call chip from clipping its text', async ({ page }) => {
  setMockedSong(ppphLeftAnchorSong)

  await page.goto('/?mockPlayer=1#/songs/future-light-sample')
  await expect(page.getByText('하이 세노! 하이! 하이! 하이하이하이하이!')).toBeVisible()

  const metrics = await page.evaluate(() => {
    const activeLine = document.querySelector('.lyric-line[data-active="true"]')
    const lane = activeLine?.querySelector('.call-lane')
    const markerText = activeLine?.querySelector<HTMLElement>('.call-marker-text')
    const laneRect = lane?.getBoundingClientRect()
    const markerTextRect = markerText?.getBoundingClientRect()

    return laneRect && markerText && markerTextRect
      ? {
          laneLeft: laneRect.left,
          laneRight: laneRect.right,
          markerLeft: markerTextRect.left,
          markerRight: markerTextRect.right,
          scrollWidth: markerText.scrollWidth,
          clientWidth: markerText.clientWidth,
        }
      : null
  })

  expect(metrics).not.toBeNull()
  expect(metrics!.markerLeft).toBeGreaterThanOrEqual(metrics!.laneLeft - 1)
  expect(metrics!.markerRight).toBeLessThanOrEqual(metrics!.laneRight + 1)
  expect(metrics!.scrollWidth).toBeLessThanOrEqual(metrics!.clientWidth + 1)
})

test('places inactive call chips at their lyric anchor instead of a leading row', async ({ page }) => {
  await page.goto('/?mockPlayer=1#/songs/future-light-sample')

  await expect(page.locator('.call-preview-chip')).toHaveCount(0)
  const inactiveLine = page.locator('.lyric-line', {
    has: page.locator('.lyric-original[aria-label="声を重ねよう"]'),
  })
  await expect(inactiveLine.locator('.call-marker[data-variant="preview"]', { hasText: '오-!' })).toBeVisible()

  const metrics = await page.evaluate(() => {
    const inactiveLine = Array.from(document.querySelectorAll('.lyric-line')).find(
      (line) => line.querySelector('.lyric-original')?.getAttribute('aria-label') === '声を重ねよう',
    )
    const marker = inactiveLine?.querySelector('.call-marker[data-variant="preview"]')
    const target = inactiveLine?.querySelector('[data-grapheme-index="4"]')
    const markerRect = marker?.getBoundingClientRect()
    const targetRect = target?.getBoundingClientRect()

    return markerRect && targetRect
      ? {
          markerCenterX: markerRect.left + markerRect.width / 2,
          targetCenterX: targetRect.left + targetRect.width / 2,
        }
      : null
  })

  expect(metrics).not.toBeNull()
  expect(Math.abs(metrics!.markerCenterX - metrics!.targetCenterX)).toBeLessThan(18)
})

test('keeps separated inactive call chips on the same vertical level', async ({ page }) => {
  setMockedSong(separatedInactivePreviewSong)

  await page.goto('/?mockPlayer=1#/songs/future-light-sample')
  const inactiveLine = page.locator('.lyric-line', {
    has: page.locator('.lyric-original[aria-label="声を重ねよう"]'),
  })
  await expect(inactiveLine.locator('.call-marker[data-variant="preview"]')).toHaveCount(2)

  const metrics = await inactiveLine.evaluate((line) => {
    const markers = Array.from(line.querySelectorAll('.call-marker[data-variant="preview"]')).map((marker) => {
      const rect = marker.getBoundingClientRect()
      return {
        centerX: rect.left + rect.width / 2,
        top: rect.top,
      }
    })

    return markers
  })

  expect(metrics).toHaveLength(2)
  expect(Math.abs(metrics[0].top - metrics[1].top)).toBeLessThan(2)
  expect(Math.abs(metrics[0].centerX - metrics[1].centerX)).toBeGreaterThan(40)
})

test('keeps a call marker anchored to a space above the lyric glyphs', async ({ page }) => {
  setMockedSong(spaceAnchorSong)

  await page.goto('/?mockPlayer=1#/songs/future-light-sample')
  await expect(page.locator('.lyric-original:not(.lyric-original-measure)', { hasText: '嗚呼 日本の魂が' })).toBeVisible()

  const metrics = await page.evaluate(() => {
    const activeLine = document.querySelector('.lyric-line[data-active="true"]')
    const marker = activeLine?.querySelector('.call-marker')
    const lyric = activeLine?.querySelector('.lyric-original')
    const markerRect = marker?.getBoundingClientRect()
    const lyricRect = lyric?.getBoundingClientRect()

    return markerRect && lyricRect
      ? {
          markerBottom: markerRect.bottom,
          lyricTop: lyricRect.top,
        }
      : null
  })

  expect(metrics).not.toBeNull()
  expect(metrics!.markerBottom).toBeLessThanOrEqual(metrics!.lyricTop - 2)
})

test('keeps lyric auto-follow from scrolling the page and clipping the video', async ({ page }) => {
  setMockedSong(autoFollowSong)

  await page.goto('/?mockPlayer=1#/songs/future-light-sample')
  await expect(page.locator('.video-frame')).toBeVisible()
  await page.evaluate(() => window.scrollTo(0, 0))

  await page.getByRole('button', { name: '+6s' }).click()
  await expect(page.locator('.lyric-line[data-position="current"]').getByLabel('星へ進む三番目')).toBeVisible()

  const metrics = await page.evaluate(() => {
    const topBarRect = document.querySelector('.player-top-bar')?.getBoundingClientRect()
    const videoRect = document.querySelector('.video-frame')?.getBoundingClientRect()

    return topBarRect && videoRect
      ? {
          scrollY: window.scrollY,
          topBarBottom: topBarRect.bottom,
          videoTop: videoRect.top,
        }
      : null
  })

  expect(metrics).not.toBeNull()
  expect(metrics!.scrollY).toBe(0)
  expect(metrics!.videoTop).toBeGreaterThanOrEqual(metrics!.topBarBottom - 1)
})

test('renders segmented lyricTrack calls as previews and active segment markers', async ({ page }) => {
  setMockedSong(segmentedSong)

  await page.goto('/?mockPlayer=1#/songs/future-light-sample')

  await expect(page.locator('.lyric-line[data-position="current"]').getByLabel('光るステージへ')).toBeVisible()
  await expect(page.locator('.lyric-line[data-position="current"]').locator('.call-marker', { hasText: '연속 콜!' })).toBeVisible()
  await expect(page.locator('.call-marker[data-variant="preview"]', { hasText: '연속 콜!' })).toBeVisible()

  await page.getByRole('button', { name: '+6s' }).click()

  const activeLine = page.locator('.lyric-line[data-position="current"]')
  await expect(activeLine.getByLabel('声を重ねよう')).toBeVisible()
  await expect(activeLine.locator('.call-marker', { hasText: '연속 콜!' })).toBeVisible()
  await expect(activeLine.locator('.call-range-end-arrow')).toBeVisible()
  await expect(activeLine.locator('.call-arrow')).toHaveCount(0)
  await expect(page.locator('.call-marker[data-variant="preview"]', { hasText: '연속 콜!' })).toBeVisible()
})

test('verifies keyboard navigation and native dialog focus management', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-05-21T12:00:00+09:00'))
  await page.goto('/?mockPlayer=1')

  // Focus Search Input on catalog page
  const searchInput = page.locator('.catalog-search input')
  await searchInput.focus()
  await expect(searchInput).toBeFocused()

  // Navigate to Event Calendar
  await page.goto('/?mockPlayer=1#/events')
  await expect(page.getByRole('heading', { name: 'Event Calendar' })).toBeVisible()

  // Focus and trigger "일정 추가" compact button
  const addButton = page.locator('.event-add-compact-button')
  await addButton.focus()
  await expect(addButton).toBeFocused()
  await page.keyboard.press('Enter')

  // Verify modal dialog is opened
  const dialogBackdrop = page.locator('dialog.event-dialog-backdrop')
  await expect(dialogBackdrop).toBeVisible()
  await expect(dialogBackdrop).toHaveAttribute('open', '')

  // Close dialog via native ESC key handling
  await page.keyboard.press('Escape')
  await expect(dialogBackdrop).not.toHaveAttribute('open', '')

  // Verify focus returned to the triggering element
  const activeClass = await page.evaluate(() => document.activeElement?.className)
  expect(activeClass).toContain('event-add-compact-button')
})
