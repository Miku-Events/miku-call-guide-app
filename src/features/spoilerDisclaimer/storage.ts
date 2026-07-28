export const SPOILER_DISCLAIMER_STORAGE_KEY =
  'miku-call-guide:spoiler-disclaimer-acknowledged'
export const SPOILER_DISCLAIMER_ACKNOWLEDGED_VALUE = '1'

type StorageReader = Pick<Storage, 'getItem'>
type StorageWriter = Pick<Storage, 'setItem'>

export function isSpoilerDisclaimerAcknowledged(storage?: StorageReader): boolean {
  try {
    const target = storage ?? window.localStorage
    return target.getItem(SPOILER_DISCLAIMER_STORAGE_KEY) === SPOILER_DISCLAIMER_ACKNOWLEDGED_VALUE
  } catch {
    return false
  }
}

export function storeSpoilerDisclaimerAcknowledgement(storage?: StorageWriter): boolean {
  try {
    const target = storage ?? window.localStorage
    target.setItem(SPOILER_DISCLAIMER_STORAGE_KEY, SPOILER_DISCLAIMER_ACKNOWLEDGED_VALUE)
    return true
  } catch {
    return false
  }
}
