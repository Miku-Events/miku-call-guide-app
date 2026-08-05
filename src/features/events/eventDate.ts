export function dateKeyFromDate(date: Date): string {
  const month = (date.getMonth() + 1).toString().padStart(2, '0')
  const day = date.getDate().toString().padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

export function parseMonthKey(month: string): Date {
  const [year, monthIndex] = month.split('-').map(Number)
  return new Date(year, monthIndex - 1, 1)
}

export function formatMonthLabel(month: string): string {
  return new Intl.DateTimeFormat('ko-KR', { month: 'long', year: 'numeric' }).format(parseMonthKey(month))
}

export function formatDateLabel(dateKey: string): string {
  const [year, month, date] = dateKey.split('-').map(Number)
  return new Intl.DateTimeFormat('ko-KR', { dateStyle: 'full' }).format(new Date(year, month - 1, date))
}

export function dayKindFromDateKey(dateKey: string): 'weekday' | 'saturday' | 'sunday' {
  const [year, month, date] = dateKey.split('-').map(Number)
  const day = new Date(year, month - 1, date).getDay()
  return day === 0 ? 'sunday' : day === 6 ? 'saturday' : 'weekday'
}

export function buildCalendarDays(month: string): string[] {
  const firstDay = parseMonthKey(month)
  const start = new Date(firstDay)
  start.setDate(1 - firstDay.getDay())
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start)
    date.setDate(start.getDate() + index)
    return dateKeyFromDate(date)
  })
}

export function calendarWeeks(calendarDays: string[]): string[][] {
  const weeks: string[][] = []
  for (let index = 0; index < calendarDays.length; index += 7) {
    weeks.push(calendarDays.slice(index, index + 7))
  }
  return weeks
}
