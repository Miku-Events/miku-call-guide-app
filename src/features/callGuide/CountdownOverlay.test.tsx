import { act, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { createPlaybackTimeStore } from '../player/playbackTimeStore'
import { CountdownOverlay } from './CountdownOverlay'
import type { CountdownCue } from './countdownSchedule'

const schedule: CountdownCue[] = [
  { id: 'countdown-chorus', startMs: 6000, endMs: 12000, source: 'explicit' },
]

describe('CountdownOverlay', () => {
  it('subscribes directly to playback time and hides at the exclusive end boundary', () => {
    const store = createPlaybackTimeStore(5999)
    render(<CountdownOverlay schedule={schedule} store={store} />)

    expect(screen.queryByRole('timer')).not.toBeInTheDocument()

    act(() => store.set(6000))
    expect(screen.getByRole('timer', { name: '카운트다운 3' })).toHaveTextContent('3')

    act(() => store.set(8000))
    expect(screen.getByRole('timer', { name: '카운트다운 2' })).toHaveTextContent('2')

    act(() => store.set(10000))
    expect(screen.getByRole('timer', { name: '카운트다운 1' })).toHaveTextContent('1')

    act(() => store.set(12000))
    expect(screen.queryByRole('timer')).not.toBeInTheDocument()
  })

  it('keeps the displayed digit fixed when playback time is paused', () => {
    const store = createPlaybackTimeStore(7000)
    render(<CountdownOverlay schedule={schedule} store={store} />)

    expect(screen.getByRole('timer', { name: '카운트다운 3' })).toBeInTheDocument()
    act(() => store.set(7000))
    expect(screen.getByRole('timer', { name: '카운트다운 3' })).toBeInTheDocument()
  })
})
