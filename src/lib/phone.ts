/**
 * Utilitário central de formatação e resolução de números e nomes de contato.
 * Garante que JIDs crus (ex.: 553599288027@s.whatsapp.net) NUNCA apareçam na interface,
 * formatando sempre como telefone brasileiro no padrão: (35) 99288-0270.
 */

export function cleanPhoneDigits(raw?: string | null): string {
  if (!raw) return ''
  // Se for JID (ex: 553599288027@s.whatsapp.net), pega a parte antes do @
  const base = raw.includes('@') ? raw.split('@')[0] : raw
  return base.replace(/\D/g, '')
}

/**
 * Formata um número ou JID como telefone brasileiro.
 * Exemplos:
 *   "553599288027@s.whatsapp.net" -> "(35) 99288-0270" ou "(35) 9928-8027"
 *   "5511999998888" -> "(11) 99999-8888"
 *   "35992880270" -> "(35) 99288-0270"
 */
export function formatPhoneBR(raw?: string | null): string {
  if (!raw) return ''
  const trimmed = String(raw).trim()
  if (trimmed.endsWith('@g.us')) return 'Grupo WhatsApp'
  if (trimmed.endsWith('@lid')) return 'Contato WhatsApp'

  let digits = cleanPhoneDigits(trimmed)
  if (!digits) return ''

  // Se vier com DDI 55 e tiver 12 ou 13 dígitos
  if (digits.startsWith('55') && (digits.length === 12 || digits.length === 13)) {
    digits = digits.slice(2)
  }

  // Celular com DDD (11 dígitos): DD + 9 dígitos
  if (digits.length === 11) {
    const ddd = digits.slice(0, 2)
    const part1 = digits.slice(2, 7)
    const part2 = digits.slice(7)
    return `(${ddd}) ${part1}-${part2}`
  }

  // Fixo ou celular antigo com DDD (10 dígitos): DD + 8 dígitos
  if (digits.length === 10) {
    const ddd = digits.slice(0, 2)
    const part1 = digits.slice(2, 6)
    const part2 = digits.slice(6)
    return `(${ddd}) ${part1}-${part2}`
  }

  // 9 dígitos (sem DDD)
  if (digits.length === 9) {
    return `${digits.slice(0, 5)}-${digits.slice(5)}`
  }

  // 8 dígitos (sem DDD)
  if (digits.length === 8) {
    return `${digits.slice(0, 4)}-${digits.slice(4)}`
  }

  // Fallback se tiver código de outro país ou formato diferente
  return digits.length > 6 ? `+${digits}` : digits
}

/**
 * Detecta valores inválidos pra nome de contato:
 * - Vazio ou apenas espaços
 * - Apenas dígitos com 10 ou mais caracteres (número cru ou LID)
 * - Identificadores genéricos como "Você", "Eu", "You", "Me", "Contato WhatsApp"
 * - Strings contendo "@" (ex: JID cru vazado no nome)
 */
export function isInvalidContactName(name?: string | null): boolean {
  if (!name) return true
  const trimmed = String(name).trim()
  if (!trimmed) return true
  if (trimmed.includes('@')) return true
  // Rejeita strings que consistem apenas em pontuação/símbolos (como ".", "-", "...", "?", "!")
  if (/^[.\-_*#@!?,:;~^`'"]+$/.test(trimmed)) return true
  // Rejeita apenas dígitos com 10 ou mais caracteres (número cru ou LID)
  if (/^\d{10,}$/.test(trimmed)) return true
  // Rejeita números com formatação de telefone crua sem letras
  if (!/[a-zA-Z\u00C0-\u017F\u0400-\u04FF\u4E00-\u9FFF\p{Emoji}]/u.test(trimmed)) {
    // Se não tiver nenhuma letra nem emoji, não é um nome de pessoa aceitável
    return true
  }
  const lower = trimmed.toLowerCase()
  if (
    [
      'você',
      'voce',
      'eu',
      'you',
      'me',
      'i',
      'contato whatsapp',
      'sem nome',
      'null',
      'undefined',
      'desconhecido',
    ].includes(lower)
  ) {
    return true
  }
  return false
}

/**
 * Resolve o nome de exibição final para qualquer contato/conversa/tarefa/notificação.
 * Ordem de prioridade:
 * 1. Nome informado (se for válido e não for número/JID cru)
 * 2. Push name alternativo (se fornecido e válido)
 * 3. Fallback formatado do JID/telefone como telefone brasileiro: "(35) 99288-0270"
 * 4. "Contato WhatsApp" ou "Grupo WhatsApp"
 */
export function resolveDisplayName(
  contactName?: string | null,
  fallbackJidOrPhone?: string | null,
  pushName?: string | null,
): string {
  if (!isInvalidContactName(contactName)) {
    return (contactName as string).trim()
  }
  if (!isInvalidContactName(pushName)) {
    return (pushName as string).trim()
  }
  const formatted = formatPhoneBR(fallbackJidOrPhone)
  if (formatted) return formatted

  if (fallbackJidOrPhone?.endsWith('@g.us')) return 'Grupo WhatsApp'
  return 'Contato WhatsApp'
}
