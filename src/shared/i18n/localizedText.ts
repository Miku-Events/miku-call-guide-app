export function localizedText(
  text: Record<string, string | undefined> | null | undefined,
  preferredKey: string,
  fallbackKeys: string[] = [],
): string {
  if (!text) {
    return ''
  }

  for (const key of [preferredKey, ...fallbackKeys]) {
    if (text[key]) {
      return text[key]
    }
  }

  return Object.values(text).find(Boolean) ?? ''
}
