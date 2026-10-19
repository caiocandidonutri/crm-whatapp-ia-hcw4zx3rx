import { describe, it, expect } from 'vitest'
import {
  isAgendaDoDiaOuListaPacientes,
  anonimizarTextoLGPD,
  extrairPrimeiroNome,
} from './repertorio_service'

describe('repertorio_service - Anonimização LGPD & Filtro de Listas', () => {
  it('detecta mensagens de agenda do dia e listas matinais com múltiplos pacientes', () => {
    const agendaMsg =
      '*Agenda dia 20/10 em Alfenas*\n12:10 - Valdene do Carmo Ribeiro de Paula Retorno Tel: (35) 8886-4696\n13:00 - Nicolas Henrique de Lima Cruz Consultoria Trimestral Tel: (35) 9725-9580\n14:00 - Vania Helena'
    expect(isAgendaDoDiaOuListaPacientes(agendaMsg)).toBe(true)

    const listaCarmo =
      '*Agenda dia 30.07 Carmo quinta-feira*\n7 Elaine Mendonça 91001.5265\n8 Alexandre Araújo 8411-1160'
    expect(isAgendaDoDiaOuListaPacientes(listaCarmo)).toBe(true)

    const msgIndividual = 'Boa tarde Maria! Tudo bem? Esperamos que esteja tudo bem por aí.'
    expect(isAgendaDoDiaOuListaPacientes(msgIndividual)).toBe(false)
  })

  it('remove números de telefone de diferentes formatos', () => {
    const textoComTel =
      'Valdene, retorno confirmado. Tel: (35) 8886-4696 ou 9920.6098 ou 35 91199-8786. Qualquer dúvida me avise!'
    const limpo = anonimizarTextoLGPD(textoComTel, 'Valdene')
    expect(limpo).not.toContain('8886-4696')
    expect(limpo).not.toContain('9920.6098')
    expect(limpo).not.toContain('91199-8786')
  })

  it('remove endereços físicos e referências conhecidas da clínica', () => {
    const textoComEndereco =
      'Valdene, seu retorno está agendado no Instituto Harmoniza Praça Emílio da Silveira ,252 Centro. Te esperamos!'
    const limpo = anonimizarTextoLGPD(textoComEndereco, 'Valdene')
    expect(limpo).not.toContain('Praça Emílio')
    expect(limpo).not.toContain('252')
  })

  it('mantém apenas o primeiro nome e remove sobrenomes', () => {
    const textoComNomeCompleto =
      'Valdene do Carmo Ribeiro de Paula, podemos confirmar o seu retorno com o Dr. Caio?'
    const limpo = anonimizarTextoLGPD(textoComNomeCompleto, 'Valdene')
    expect(limpo).toContain('Valdene')
    expect(limpo).not.toContain('do Carmo Ribeiro de Paula')
  })

  it('extrai primeiro nome corretamente', () => {
    expect(extrairPrimeiroNome('Valdene do Carmo Ribeiro de Paula')).toBe('Valdene')
    expect(extrairPrimeiroNome('Maria Silva')).toBe('Maria')
    expect(extrairPrimeiroNome(null)).toBe('Paciente')
    expect(extrairPrimeiroNome('')).toBe('Paciente')
  })
})
