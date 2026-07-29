export function formatChatListTimestamp(ts: number | string | Date | null | undefined): string {
  if (!ts) return ''

  try {
    let dateValue: Date

    if (ts instanceof Date) {
      dateValue = ts
    } else {
      const numTs = Number(ts)
      if (!isNaN(numTs) && numTs > 0) {
        // If it's a numeric timestamp (number or string representation)
        // Assume < 1e12 is in seconds, >= 1e12 is in milliseconds
        dateValue = new Date(numTs < 1e12 ? numTs * 1000 : numTs)
      } else {
        // If it's an ISO date string or similar
        dateValue = new Date(ts)
      }
    }

    if (isNaN(dateValue.getTime())) return String(ts)

    const now = new Date()
    const isToday =
      dateValue.getDate() === now.getDate() &&
      dateValue.getMonth() === now.getMonth() &&
      dateValue.getFullYear() === now.getFullYear()

    if (isToday) {
      return dateValue.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    }

    const yesterday = new Date(now)
    yesterday.setDate(yesterday.getDate() - 1)
    const isYesterday =
      dateValue.getDate() === yesterday.getDate() &&
      dateValue.getMonth() === yesterday.getMonth() &&
      dateValue.getFullYear() === yesterday.getFullYear()

    if (isYesterday) {
      return 'Ontem'
    }

    return dateValue.toLocaleDateString([], { day: '2-digit', month: '2-digit', year: 'numeric' })
  } catch (error) {
    return String(ts)
  }
}
