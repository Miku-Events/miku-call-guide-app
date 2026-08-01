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
  dataVersion: 'e2e',
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
  dataVersion: 'e2e',
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
  dataVersion: 'e2e',
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
  dataVersion: 'e2e',
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

const longIntroCountdownSong = {
  ...song,
  lyrics: [
    {
      ...song.lyrics[0],
      time: '00:00:06,000 --> 00:00:12,000',
      startMs: 6000,
      endMs: 12000,
    },
    {
      ...song.lyrics[1],
      time: '00:00:12,000 --> 00:00:18,000',
      startMs: 12000,
      endMs: 18000,
    },
  ],
}

const shortIntro60MsSong = {
  ...song,
  lyrics: [
    {
      ...song.lyrics[0],
      time: '00:00:00,060 --> 00:00:06,060',
      startMs: 60,
      endMs: 6060,
    },
    {
      ...song.lyrics[1],
      time: '00:00:06,060 --> 00:00:12,060',
      startMs: 6060,
      endMs: 12060,
    },
  ],
}

const shortIntro180MsSong = {
  ...song,
  lyrics: [
    {
      ...song.lyrics[0],
      time: '00:00:00,180 --> 00:00:06,180',
      startMs: 180,
      endMs: 6180,
    },
    {
      ...song.lyrics[1],
      time: '00:00:06,180 --> 00:00:12,180',
      startMs: 6180,
      endMs: 12180,
    },
  ],
}

const explicitCountdownSong = {
  ...song,
  lyrics: [
    song.lyrics[0],
    {
      ...song.lyrics[1],
      time: '00:00:12,000 --> 00:00:18,000',
      startMs: 12000,
      endMs: 18000,
    },
  ],
  countdownEvents: [
    {
      id: 'countdown-second-line',
      time: '00:00:06,000 --> 00:00:12,000',
      startMs: 6000,
      endMs: 12000,
    },
  ],
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


export {
  attakaitoWrappedEndAnchorSong,
  autoFollowSong,
  callGuideManifest,
  crossLaneAnchorRailSong,
  dateOnlyEventDetail,
  dateOnlyEventSummary,
  endAnchorSong,
  explicitCountdownSong,
  eventCalendarIndex,
  eventCalendarMayMonth,
  eventCalendarMonth,
  eventDetail,
  leftAnchorSong,
  longIntroCountdownSong,
  longLyricSong,
  multiDayEventDetail,
  overlappingKindSong,
  ppphLeftAnchorSong,
  rootManifest,
  segmentedSong,
  separatedInactivePreviewSong,
  shortIntro180MsSong,
  shortIntro60MsSong,
  song,
  spaceAnchorSong,
  wordWrapSong,
  wrappedRangeSong,
}
