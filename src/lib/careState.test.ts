import { describe, it, expect } from 'vitest'
import { reconcileCareState } from './careState'

describe('reconcileCareState', () => {
  const baseNow = new Date('2025-05-15T14:00:00.000Z')

  // (a) paciente escreve -> humana responde -> estado sai de "responder"
  it('cenario (a): paciente escreve -> estado "responder"; humana responde -> estado sai de "responder" ("contatado")', () => {
    // 1. Paciente escreveu às 10:00
    const patientMsg = {
      id: 'm1',
      from_me: false,
      timestamp: new Date('2025-05-15T10:00:00.000Z').toISOString(),
      origin: 'desconhecido',
    }

    const stateBeforeHuman = reconcileCareState({
      messages: [patientMsg],
      now: baseNow,
    })

    expect(stateBeforeHuman.state).toBe('responder')
    expect(stateBeforeHuman.alertActive).toBe(true)

    // 2. Humana responde às 11:00 (origin: humano_celular ou humano_crm)
    const humanMsg = {
      id: 'm2',
      from_me: true,
      timestamp: new Date('2025-05-15T11:00:00.000Z').toISOString(),
      origin: 'humano_crm' as const,
    }

    const stateAfterHuman = reconcileCareState({
      messages: [patientMsg, humanMsg],
      now: baseNow,
    })

    expect(stateAfterHuman.state).toBe('contatado')
    expect(stateAfterHuman.alertActive).toBe(false)
    expect(stateAfterHuman.lastHumanContactAt).toBe(
      new Date('2025-05-15T11:00:00.000Z').toISOString(),
    )
  })

  // (b) consulta de hoje passada -> "atendido_a_fechar"
  it('cenario (b): consulta de hoje cujo horario ja passou -> "atendido_a_fechar"', () => {
    // Agora é 14:00 em UTC (11:00 em SP)
    // Consulta era às 13:00 em UTC (10:00 em SP) - mesmo dia em SP
    const apptTodayPassed = {
      id: 'a1',
      starts_at: '2025-05-15T13:00:00.000Z',
      status: 'confirmado',
    }

    const result = reconcileCareState({
      appointments: [apptTodayPassed],
      messages: [
        {
          id: 'm1',
          from_me: true,
          origin: 'humano_crm',
          timestamp: '2025-05-15T12:00:00.000Z',
        },
      ],
      now: baseNow,
    })

    expect(result.state).toBe('atendido_a_fechar')
    expect(result.alertActive).toBe(false)
  })

  // (c) consulta amanha com lembrete -> "confirmacao_enviada"
  it('cenario (c): consulta amanha com lembrete/confirmacao enviada -> "confirmacao_enviada"', () => {
    // Consulta amanhã às 14:00 (24h no futuro, logo <= 48h)
    const apptTomorrow = {
      id: 'a2',
      starts_at: '2025-05-16T14:00:00.000Z',
      status: 'agendado',
      reminder_sent: true,
    }

    const result = reconcileCareState({
      appointments: [apptTomorrow],
      messages: [
        {
          id: 'm1',
          from_me: true,
          origin: 'automacao',
          timestamp: '2025-05-15T12:00:00.000Z',
        },
      ],
      now: baseNow,
    })

    expect(result.state).toBe('confirmacao_enviada')
    expect(result.alertActive).toBe(false)
  })

  // (d) paciente responde de novo -> volta a "responder"
  it('cenario (d): paciente responde de novo apos confirmacao/contato -> volta a "responder"', () => {
    const apptTomorrow = {
      id: 'a2',
      starts_at: '2025-05-16T14:00:00.000Z',
      status: 'agendado',
      reminder_sent: true,
    }

    // Humana falou às 11:00, mas paciente mandou nova mensagem às 13:30 (antes das 14:00)
    const messages = [
      {
        id: 'm1',
        from_me: true,
        origin: 'humano_crm',
        timestamp: '2025-05-15T11:00:00.000Z',
      },
      {
        id: 'm2',
        from_me: false,
        origin: 'desconhecido',
        timestamp: '2025-05-15T13:30:00.000Z',
      },
    ]

    const result = reconcileCareState({
      appointments: [apptTomorrow],
      messages,
      now: baseNow,
    })

    // Como o paciente falou por último e ninguém respondeu depois, prioridade máxima é "responder" (único que alerta)
    expect(result.state).toBe('responder')
    expect(result.alertActive).toBe(true)
  })
})
