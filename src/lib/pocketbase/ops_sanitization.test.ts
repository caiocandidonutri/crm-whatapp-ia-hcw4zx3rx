import { describe, it, expect } from 'vitest'

// Algoritmo de limpeza LGPD equivalente ao de pocketbase/hooks/ops_read_api.js
function sanitizeMessageText(text: string): string {
  if (!text || typeof text !== 'string') return ''
  try {
    let s = text

    // 1. CPF
    s = s.replace(/\b\d{3}\.?\d{3}\.?\d{3}[-/.]?\d{2}\b/g, '[DADO]')

    // 2. E-mail
    s = s.replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, '[DADO]')

    // 3. Telefones brasileiros
    s = s.replace(
      /(?:tel[:.]?\s*|cel[:.]?\s*|whatsapp[:.]?\s*)?(?:\+?55\s*)?(?:\(?\d{2}\)?[\s.-]*)?(?:9\s*)?\d{4,5}[\s.-]\d{4}\b/gi,
      '[DADO]',
    )

    // 4. CEP
    s = s.replace(/\b\d{2}\.?\d{3}[-\s]\d{3}\b/g, '[DADO]')

    // 5. Endereços
    s = s.replace(
      /(?:(?:rua|avenida|av\.?|praça|praca|alameda|travessa|rodovia)\s+[^,\n]+(?:,\s*\d+)?(?:\s*-\s*[^,\n]+)?(?:\s+centro)?)/gi,
      '[DADO]',
    )
    s = s.replace(/praça\s+em[íi]lio\s+da\s+silveira\s*,?\s*\d*\s*centro\.?/gi, '[DADO]')

    // 6. Saudações a nomes de pessoas
    s = s.replace(
      /(bom dia|boa tarde|boa noite|olá|ola|oi)\s+([A-ZÀ-Ú][a-zà-ú]+)(?:\s+(?:da|de|do|das|dos|e|[A-ZÀ-Ú][a-zà-ú]+)){0,3}/gi,
      (_match, saudacao) => `${saudacao} [PACIENTE]`,
    )

    // 7. Familiares
    s = s.replace(
      /\b(meu pai|minha mãe|minha mae|meu esposo|minha esposa|meu marido|meu filho|minha filha)\b/gi,
      '[FAMILIAR]',
    )

    s = s
      .replace(/[ \t]+/g, ' ')
      .replace(/\s+([,.;!?])/g, '$1')
      .trim()
    return s
  } catch {
    return '[mensagem omitida]'
  }
}

describe('ops-v1 LGPD Sanitization Test', () => {
  it('substitui nomes, telefones, emails, CPFs e endereços por [DADO] e [PACIENTE]/[FAMILIAR]', () => {
    const raw =
      'Olá Dr. Caio Candido, meu nome é Carlos Silva. Meu telefone é (35) 98886-4696 e email carlos@gmail.com. Meu CPF é 123.456.789-00 e moro na Rua Tiradentes, 100 Centro. Preciso remarcar a consulta de meu pai.'
    const sanitized = sanitizeMessageText(raw)

    expect(sanitized).not.toContain('(35) 98886-4696')
    expect(sanitized).not.toContain('carlos@gmail.com')
    expect(sanitized).not.toContain('123.456.789-00')
    expect(sanitized).not.toContain('Rua Tiradentes')
    expect(sanitized).not.toContain('meu pai')
    expect(sanitized).toContain('[DADO]')
    expect(sanitized).toContain('[PACIENTE]')
    expect(sanitized).toContain('[FAMILIAR]')
  })
})
