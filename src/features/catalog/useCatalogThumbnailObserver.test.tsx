import { act, cleanup, render } from '@testing-library/react'
import { useEffect, useRef } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  useCatalogThumbnailObserver,
  type ObserveCatalogThumbnail,
} from './useCatalogThumbnailObserver'

class IntersectionObserverHarness implements IntersectionObserver {
  static instances: IntersectionObserverHarness[] = []

  readonly root: Element | Document | null
  readonly rootMargin: string
  readonly thresholds: readonly number[]
  readonly targets = new Set<Element>()
  disconnected = false

  constructor(
    readonly callback: IntersectionObserverCallback,
    options: IntersectionObserverInit = {},
  ) {
    this.root = options.root ?? null
    this.rootMargin = options.rootMargin ?? '0px'
    this.thresholds = Array.isArray(options.threshold)
      ? options.threshold
      : [options.threshold ?? 0]
    IntersectionObserverHarness.instances.push(this)
  }

  disconnect(): void {
    this.disconnected = true
    this.targets.clear()
  }

  observe(target: Element): void {
    this.targets.add(target)
  }

  takeRecords(): IntersectionObserverEntry[] {
    return []
  }

  unobserve(target: Element): void {
    this.targets.delete(target)
  }

  intersect(target: Element): void {
    this.callback([{
      isIntersecting: true,
      target,
    } as IntersectionObserverEntry], this)
  }
}

function ObservedThumbnail({ loaded, observe, songId }: {
  loaded: boolean
  observe: ObserveCatalogThumbnail
  songId: string
}) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!loaded && ref.current) {
      return observe(ref.current, songId)
    }
  }, [loaded, observe, songId])

  return (
    <div data-testid={`target-${songId}`} ref={ref}>
      {loaded ? <img alt="" data-testid={`image-${songId}`} /> : null}
    </div>
  )
}

function ThumbnailHarness({ songIds }: { songIds: string[] }) {
  const {
    loadedSongIds,
    observeThumbnail,
    resetThumbnailVersion,
  } = useCatalogThumbnailObserver()

  return (
    <main className="app-main">
      <button onClick={() => resetThumbnailVersion('v2')} type="button">reset</button>
      {songIds.map((songId) => (
        <ObservedThumbnail
          key={songId}
          loaded={loadedSongIds.has(songId)}
          observe={observeThumbnail}
          songId={songId}
        />
      ))}
    </main>
  )
}

beforeEach(() => {
  IntersectionObserverHarness.instances = []
  vi.stubGlobal('IntersectionObserver', IntersectionObserverHarness)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('useCatalogThumbnailObserver', () => {
  it('shares one observer and retains loaded IDs for the active data version', () => {
    const view = render(<ThumbnailHarness songIds={['a', 'b', 'c']} />)
    const targets = Array.from(view.container.querySelectorAll('[data-testid^="target-"]'))

    expect(IntersectionObserverHarness.instances).toHaveLength(1)
    const observer = IntersectionObserverHarness.instances[0]
    expect(observer.root).toBeNull()
    expect(observer.rootMargin).toBe('200px 0px')
    expect(observer.thresholds).toEqual([0.01])
    expect(observer.targets.size).toBe(3)
    expect(view.container.querySelectorAll('img')).toHaveLength(0)

    act(() => observer.intersect(targets[1]))

    expect(view.getByTestId('image-b')).toBeInTheDocument()
    expect(view.container.querySelectorAll('img')).toHaveLength(1)
    expect(observer.targets.has(targets[1])).toBe(false)

    view.rerender(<ThumbnailHarness songIds={['a', 'c']} />)
    expect(view.queryByTestId('image-b')).not.toBeInTheDocument()
    view.rerender(<ThumbnailHarness songIds={['a', 'b', 'c']} />)
    expect(view.getByTestId('image-b')).toBeInTheDocument()

    act(() => view.getByRole('button', { name: 'reset' }).click())
    expect(view.queryByTestId('image-b')).not.toBeInTheDocument()
    expect(observer.disconnected).toBe(true)
    expect(IntersectionObserverHarness.instances).toHaveLength(2)

    view.unmount()
    expect(IntersectionObserverHarness.instances[1].disconnected).toBe(true)
  })

  it('marks a thumbnail loaded when IntersectionObserver is unavailable', () => {
    vi.stubGlobal('IntersectionObserver', undefined)
    const view = render(<ThumbnailHarness songIds={['fallback']} />)

    expect(view.getByTestId('image-fallback')).toBeInTheDocument()
  })
})
