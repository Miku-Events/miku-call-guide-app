interface EventWithId {
  id: string
}

interface WarningResult {
  warning?: string
}

export function eventPageWarning(
  indexWarning: string | undefined,
  monthWarning: string | undefined,
  selectedEvents: readonly EventWithId[],
  eventDetails: Readonly<Record<string, WarningResult | undefined>>,
): string | undefined {
  const warnings = [
    indexWarning,
    monthWarning,
    ...selectedEvents.map((event) => eventDetails[event.id]?.warning),
  ].filter((warning): warning is string => Boolean(warning))

  const message = [...new Set(warnings)].join(' ')
  return message || undefined
}
