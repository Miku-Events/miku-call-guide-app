import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const css = readFileSync(join(process.cwd(), 'src', 'index.css'), 'utf8').replace(/\r\n/g, '\n')

function getBlock(source: string, marker: string, occurrence = 0) {
  let markerIndex = -1
  let searchFrom = 0
  for (let index = 0; index <= occurrence; index += 1) {
    markerIndex = source.indexOf(marker, searchFrom)
    searchFrom = markerIndex + marker.length
    if (markerIndex < 0) {
      break
    }
  }

  expect(markerIndex, `${marker} was not found`).toBeGreaterThanOrEqual(0)

  const openBraceIndex = source.indexOf('{', markerIndex)
  expect(openBraceIndex, `${marker} has no opening brace`).toBeGreaterThanOrEqual(0)

  let depth = 0
  for (let index = openBraceIndex; index < source.length; index += 1) {
    const char = source[index]
    if (char === '{') {
      depth += 1
    }
    if (char === '}') {
      depth -= 1
      if (depth === 0) {
        return source.slice(openBraceIndex + 1, index)
      }
    }
  }

  throw new Error(`${marker} has no closing brace`)
}

function expectDeclaration(body: string, property: string, value: string) {
  const normalizedBody = body.replace(/\s+/g, ' ')
  expect(normalizedBody).toContain(`${property}: ${value};`)
}

function parseHexColor(color: string): [number, number, number] {
  const match = color.trim().match(/^#([0-9a-f]{6})$/i)
  expect(match, `${color} should be a six-digit hex color`).not.toBeNull()
  const value = match![1]
  return [
    Number.parseInt(value.slice(0, 2), 16),
    Number.parseInt(value.slice(2, 4), 16),
    Number.parseInt(value.slice(4, 6), 16),
  ]
}

function colorDistance(colorA: string, colorB: string): number {
  const [redA, greenA, blueA] = parseHexColor(colorA)
  const [redB, greenB, blueB] = parseHexColor(colorB)
  return Math.hypot(redA - redB, greenA - greenB, blueA - blueB)
}

describe('player layout CSS contracts', () => {
  it('keeps catalog and events on the shared dark app shell structure', () => {
    const appShell = getBlock(css, '.app-page-shell')
    expectDeclaration(appShell, '--app-bg', '#09090b')
    expectDeclaration(appShell, '--app-surface', '#111113')
    expectDeclaration(appShell, '--app-surface-raised', '#18181b')
    expectDeclaration(appShell, '--app-panel', '#1f1f23')
    expectDeclaration(appShell, 'color-scheme', 'dark')
    expectDeclaration(appShell, 'background', 'var(--app-bg)')

    const appTopBar = getBlock(css, '.app-top-bar')
    expectDeclaration(appTopBar, 'background', 'color-mix(in srgb, var(--color-background-body) 92%, transparent)')

    const appToolbar = getBlock(css, '.app-toolbar {')
    expectDeclaration(appToolbar, 'display', 'grid')
    expectDeclaration(appToolbar, 'border-radius', 'var(--radius-element)')

    const appSummaryItem = getBlock(css, '.app-summary-item {')
    expectDeclaration(appSummaryItem, 'border-radius', 'var(--radius-element)')

    const appStatusBanner = getBlock(css, '.app-status-banner {')
    expectDeclaration(appStatusBanner, 'display', 'flex')
    expectDeclaration(appStatusBanner, 'border-radius', 'var(--radius-element)')

    const eventCompactAddButton = getBlock(css, '.event-add-compact-button {')
    expectDeclaration(eventCompactAddButton, 'min-height', '2rem')
    expectDeclaration(eventCompactAddButton, 'font-size', '0.78rem')

    const catalogShell = getBlock(css, '.catalog-shell')
    expectDeclaration(catalogShell, '--catalog-bg', 'var(--app-bg)')
    expectDeclaration(catalogShell, '--catalog-surface', 'var(--app-surface)')
    expectDeclaration(catalogShell, '--catalog-surface-raised', 'var(--app-surface-raised)')
    expectDeclaration(catalogShell, '--catalog-panel', 'var(--app-panel)')
    expectDeclaration(catalogShell, 'color-scheme', 'dark')
    expectDeclaration(catalogShell, 'background', 'var(--catalog-bg)')

    const eventShell = getBlock(css, '.event-shell')
    expectDeclaration(eventShell, '--event-bg', 'var(--app-bg)')
    expectDeclaration(eventShell, '--event-surface', 'var(--app-surface)')
    expectDeclaration(eventShell, '--event-panel', 'var(--app-panel)')
    expectDeclaration(eventShell, 'background', 'var(--event-bg)')

    const catalogToolbar = getBlock(css, '.catalog-shell .app-toolbar')
    expectDeclaration(catalogToolbar, 'grid-template-columns', 'minmax(0, 1fr) auto')

    const catalogContentPanel = getBlock(css, '.catalog-content-panel')
    expectDeclaration(catalogContentPanel, 'overflow', 'auto')
    expectDeclaration(catalogContentPanel, 'border-radius', 'var(--radius-element)')

    const catalogGrid = getBlock(css, '.catalog-song-grid')
    expectDeclaration(catalogGrid, 'display', 'grid')
    expectDeclaration(catalogGrid, 'grid-template-columns', 'repeat(auto-fill, minmax(min(100%, 22rem), 1fr))')

    const catalogCard = getBlock(css, '.catalog-song-card {')
    expectDeclaration(catalogCard, 'min-height', '13.5rem')
    expectDeclaration(catalogCard, 'border-radius', 'var(--radius-element)')
    expectDeclaration(catalogCard, 'background', 'var(--catalog-surface)')
  })

  it('keeps the call guide player on the same neutral dark palette', () => {
    const playerShell = getBlock(css, '.player-shell')
    expectDeclaration(playerShell, '--player-bg', '#09090b')
    expectDeclaration(playerShell, '--player-surface', '#111113')
    expectDeclaration(playerShell, '--player-surface-raised', '#18181b')
    expectDeclaration(playerShell, '--player-panel', '#1f1f23')
    expectDeclaration(playerShell, 'color-scheme', 'dark')
    expectDeclaration(playerShell, 'background', 'var(--player-bg)')

    const topBar = getBlock(css, '.player-top-bar')
    expectDeclaration(topBar, 'background', 'rgba(9, 9, 11, 0.92)')

    const liveLyricsPanel = getBlock(css, '.live-lyrics-panel', 1)
    expectDeclaration(liveLyricsPanel, 'background', 'rgba(17, 17, 19, 0.88)')

    const playerCss = css.slice(css.indexOf('.player-shell'))
    expect(playerCss).not.toContain('#041a1c')
    expect(playerCss).not.toContain('#020d0e')
    expect(playerCss).not.toContain('#06292c')
    expect(playerCss).not.toContain('rgba(4, 26, 28')
    expect(playerCss).not.toContain('rgba(2, 13, 14')
  })

  it('defines distinct call kind colors for chant, penlight, and custom calls', () => {
    expect(css).toContain('.call-marker[data-kind="penlight"]')
    expect(css).toContain('.call-marker[data-kind="custom"]')
    expect(css).toContain('--call-color: #da3c5e;')
    expect(css).toContain('--call-color: #38d6e8;')
    expect(css).toContain('--call-color: #f4b35d;')
    expect(css).toContain('.global-call-item[data-kind="penlight"]')
    expect(css).toContain('.call-kind-legend-item[data-kind="penlight"]')
    expect(css).toContain('.call-kind-dot')
    expect(css).toContain('border-radius: var(--radius-full);')
    expect(css).toContain('.player-shell .call-marker-text')
    expect(css).toContain('background: var(--call-color);')
  })

  it('defines a unique color token set for each event type', () => {
    const eventTypes = [
      'concert',
      'dj',
      'popup',
      'ticketApplication',
      'ticketGeneralSale',
      'livestream',
      'exhibition',
      'collaboration',
      'announcement',
      'other',
    ]
    const textColors = eventTypes.map((type) => {
      const body = getBlock(css, `[data-event-type="${type}"]`)
      const match = body.match(/--event-type-text:\s*([^;]+);/)
      expect(match, `${type} needs --event-type-text`).not.toBeNull()
      expect(body, `${type} needs --event-type-bg`).toContain('--event-type-bg:')
      expect(body, `${type} needs --event-type-border`).toContain('--event-type-border:')
      return match![1]
    })

    expect(new Set(textColors).size).toBe(eventTypes.length)
    for (let index = 0; index < textColors.length; index += 1) {
      for (let nextIndex = index + 1; nextIndex < textColors.length; nextIndex += 1) {
        expect(
          colorDistance(textColors[index], textColors[nextIndex]),
          `${eventTypes[index]} and ${eventTypes[nextIndex]} colors should be visually separated`,
        ).toBeGreaterThanOrEqual(48)
      }
    }
  })

  it('keeps the full lyric list as a bounded vertical scroll viewport', () => {
    const lyricList = getBlock(css, '.lyric-list')
    expectDeclaration(lyricList, 'display', 'flex')
    expectDeclaration(lyricList, 'flex-direction', 'column')
    expectDeclaration(lyricList, 'overflow-y', 'auto')

    const lyricLine = getBlock(css, '.lyric-line')
    expectDeclaration(lyricLine, 'flex', '0 0 auto')

    const lyricShell = getBlock(css, '.lyric-list-shell')
    expectDeclaration(lyricShell, 'overflow', 'hidden')
  })

  it('wraps lyrics by token instead of breaking inside words', () => {
    const lyricOriginal = getBlock(css, '.lyric-original')
    expectDeclaration(lyricOriginal, 'overflow-wrap', 'normal')
    expectDeclaration(lyricOriginal, 'word-break', 'normal')

    const lyricToken = getBlock(css, '.lyric-token {')
    expectDeclaration(lyricToken, 'display', 'inline-flex')
    expectDeclaration(lyricToken, 'white-space', 'nowrap')
  })

  it('prevents desktop player containers from expanding to the full lyric content height', () => {
    const playerGrid = getBlock(css, '.player-grid')
    expectDeclaration(playerGrid, 'min-height', '0')

    const lyricsPanel = getBlock(css, '.live-lyrics-panel', 1)
    expectDeclaration(lyricsPanel, 'display', 'flex')
    expectDeclaration(lyricsPanel, 'flex-direction', 'column')

    const desktopCss = getBlock(css, '@media (min-width: 921px)')
    const desktopGrid = getBlock(desktopCss, '.player-grid')
    expectDeclaration(desktopGrid, 'grid-template-columns', 'minmax(0, 58fr) minmax(26rem, 42fr)')
    expectDeclaration(desktopGrid, 'height', '100%')
    expectDeclaration(desktopGrid, 'min-height', '0')
    expectDeclaration(desktopGrid, 'overflow', 'hidden')

    const desktopVideoPanel = getBlock(desktopCss, '.player-video-panel')
    expectDeclaration(desktopVideoPanel, 'padding', 'clamp(1.25rem, 2vh, 2rem) clamp(0.75rem, 1.2vw, 1.35rem)')

    const desktopList = getBlock(desktopCss, '.player-shell .lyric-list')
    expectDeclaration(desktopList, 'height', '100%')
    expectDeclaration(desktopList, 'max-height', 'none')
    expectDeclaration(desktopList, 'min-height', '0')

    const desktopShell = getBlock(desktopCss, '.player-shell .lyric-list-shell')
    expectDeclaration(desktopShell, 'flex', '1 1 auto')
    expectDeclaration(desktopShell, 'overflow', 'hidden')

    const playerCurrentLyric = getBlock(css, '.player-shell .lyric-line[data-position="current"] .lyric-original')
    expectDeclaration(playerCurrentLyric, 'row-gap', '1.45rem')
  })
})
