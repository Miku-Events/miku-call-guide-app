export function formatMs(valueMs: number): string {
  const safeMs = Math.max(0, Math.floor(valueMs))
  const totalSeconds = Math.floor(safeMs / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  const tenths = Math.floor((safeMs % 1000) / 100)

  return `${minutes}:${seconds.toString().padStart(2, '0')}.${tenths}`
}
