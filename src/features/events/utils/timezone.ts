// Popular timezones prioritized at the top of autocomplete suggestions
export const POPULAR_TIMEZONES = [
  'Asia/Seoul',
  'Asia/Tokyo',
  'Asia/Taipei',
  'Asia/Shanghai',
  'Asia/Singapore',
  'Europe/London',
  'Europe/Paris',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'UTC',
]

// Retrieve all supported standard IANA timezones from the browser
let ALL_TIMEZONES: string[] = []
try {
  ALL_TIMEZONES = Intl.supportedValuesOf('timeZone')
} catch {
  // Fallback if unsupported
  ALL_TIMEZONES = [...POPULAR_TIMEZONES]
}

// Generate the complete prioritized timezone list (popular ones first, followed by remaining alphabetically)
export const COMBINED_TIMEZONES = Array.from(
  new Set([
    ...POPULAR_TIMEZONES.filter(tz => ALL_TIMEZONES.includes(tz)),
    ...ALL_TIMEZONES.sort(),
  ])
)

/**
 * Computes the exact timezone offset (e.g. "+09:00", "-04:00") for a given date-time in the specified IANA timezone.
 * Uses native Intl API, robustly accounting for Daylight Saving Time (DST) changes.
 */
export function getOffsetForTimezone(timezone: string, dateStr: string): string {
  try {
    const tzFormatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      timeZoneName: 'longOffset',
    })
    
    // Perform standard estimation using UTC base date
    const tempDate = new Date(dateStr + 'Z')
    if (isNaN(tempDate.getTime())) return '+00:00'
    
    const estimateParts = tzFormatter.formatToParts(tempDate)
    const tzName = estimateParts.find(p => p.type === 'timeZoneName')?.value || 'GMT'
    
    let offsetMinutes = 0
    const match = tzName.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/)
    if (match) {
      const [, sign, hours, minutes = '00'] = match
      offsetMinutes = parseInt(hours) * 60 + parseInt(minutes)
      if (sign === '-') offsetMinutes = -offsetMinutes
    }
    
    // Adjust target UTC relative to estimated offset to find precise time instant
    const targetUtc = tempDate.getTime() - offsetMinutes * 60 * 1000
    const finalParts = tzFormatter.formatToParts(new Date(targetUtc))
    const finalTzName = finalParts.find(p => p.type === 'timeZoneName')?.value || 'GMT'
    
    if (finalTzName === 'GMT') return '+00:00'
    const finalMatch = finalTzName.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/)
    if (!finalMatch) return '+00:00'
    
    const [, sign, hours, minutes = '00'] = finalMatch
    return `${sign}${hours.padStart(2, '0')}:${minutes}`
  } catch {
    return '+00:00'
  }
}

/**
 * Encodes a local datetime string (YYYY-MM-DDTHH:mm) into a fully resolved ISO-8601 string (YYYY-MM-DDTHH:mm:ss+ZZ:ZZ).
 */
export function formatIsoWithOffset(localDateTime: string, timezone: string): string {
  if (!localDateTime) return ''
  // Standardize to include seconds if missing (e.g. YYYY-MM-DDTHH:mm -> YYYY-MM-DDTHH:mm:00)
  let standardDateTime = localDateTime
  if (standardDateTime.length === 16) {
    standardDateTime += ':00'
  }
  const offset = getOffsetForTimezone(timezone, standardDateTime)
  return `${standardDateTime}${offset}`
}
