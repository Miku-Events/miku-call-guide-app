import { describe, expect, it, vi } from 'vitest'

async function markerModule() {
  const modulePath = './release-marker.mjs'
  return import(/* @vite-ignore */ modulePath)
}

describe('release marker', () => {
  it('prefers an explicit release id and emits deterministic public JSON', async () => {
    const { releaseMarkerSource, resolveReleaseId } = await markerModule()
    const releaseId = resolveReleaseId({
      GITHUB_SHA: 'github-sha',
      VITE_RELEASE_ID: 'explicit-release',
    })

    expect(releaseId).toBe('explicit-release')
    expect(releaseMarkerSource(releaseId)).toBe('{"releaseId":"explicit-release"}\n')
  })

  it('falls back to GITHUB_SHA and then a stable local marker', async () => {
    const { resolveReleaseId } = await markerModule()

    expect(resolveReleaseId({ GITHUB_SHA: '0123456789abcdef' })).toBe('0123456789abcdef')
    expect(resolveReleaseId({})).toBe('local-development')
  })

  it('emits the resolved marker as a deterministic Vite build asset', async () => {
    const { createReleaseMarkerPlugin } = await markerModule()
    const emitFile = vi.fn()
    const plugin = createReleaseMarkerPlugin({ VITE_RELEASE_ID: 'build-release' })

    plugin.generateBundle.call({ emitFile })

    expect(emitFile).toHaveBeenCalledWith({
      fileName: 'release.json',
      source: '{"releaseId":"build-release"}\n',
      type: 'asset',
    })
  })

  it.each([
    'contains spaces',
    'contains/slash',
    'YOUR_RELEASE_ID',
    'x'.repeat(129),
  ])('rejects unsafe release id %s', async (releaseId) => {
    const { resolveReleaseId } = await markerModule()

    expect(() => resolveReleaseId({ VITE_RELEASE_ID: releaseId })).toThrow(/release id/i)
  })
})
