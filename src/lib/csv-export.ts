export function escapeCsvField(value: unknown): string {
  if (value == null) return ''
  const str = String(value)
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`
  }
  return str
}

export function downloadCsv(filename: string, rows: string[][]): void {
  const bom = '\uFEFF'
  const csvContent = bom + rows.map((row) => row.map(escapeCsvField).join(',')).join('\r\n')

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.style.display = 'none'
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

export function extractPhoneFromJid(jid?: string): string {
  if (!jid) return ''
  const match = jid.match(/^(\d+)@/)
  return match ? match[1] : ''
}
