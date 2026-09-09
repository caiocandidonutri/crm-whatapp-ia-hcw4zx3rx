import { formatChatListTimestampSaoPaulo } from './datetime'

export function formatChatListTimestamp(ts: number | string | Date | null | undefined): string {
  return formatChatListTimestampSaoPaulo(ts)
}
