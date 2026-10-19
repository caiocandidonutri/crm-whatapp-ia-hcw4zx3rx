import pb from '@/lib/pocketbase/client'
import type { Payment, PaymentMethod } from '@/types/models'
import { isNetworkError } from '@/lib/pocketbase/errors'

export interface CreatePaymentInput {
  account_id?: string
  appointment_id?: string
  crm_contact_id?: string
  valor: number
  forma_pagamento: PaymentMethod
  data_pagamento: string
  unidade?: string
  observacoes?: string
}

export interface PaymentSummary {
  receitaMesAtual: number
  receitaMesAnterior: number
  ticketMedioMes: number
  totalAtendimentosMes: number
  totalPorForma: Record<PaymentMethod, number>
  totalPorUnidade: Record<string, number>
  orcamentosAbertosTotal: number
  orcamentosAbertosQtd: number
}

export const FORMA_PAGAMENTO_LABELS: Record<PaymentMethod, string> = {
  pix: 'Pix',
  cartao: 'Cartão de Crédito/Débito',
  dinheiro: 'Dinheiro',
  transferencia: 'Transferência Bancária',
}

/**
 * Cria um registro de pagamento por atendimento.
 */
export async function createPayment(input: CreatePaymentInput): Promise<Payment> {
  const currentUserId = pb.authStore.record?.id
  const payload = {
    ...input,
    created_by: currentUserId,
  }
  return pb.collection('payments').create<Payment>(payload)
}

/**
 * Lista pagamentos com filtros opcionais de data, unidade ou forma de pagamento.
 */
export async function listPayments(options?: {
  accountId?: string
  startDate?: string
  endDate?: string
  forma?: PaymentMethod | 'all'
  unidade?: string | 'all'
  appointmentId?: string
  contactId?: string
}): Promise<Payment[]> {
  const filters: string[] = []

  if (options?.accountId) {
    filters.push(`account_id = "${options.accountId}"`)
  }
  if (options?.startDate) {
    filters.push(`data_pagamento >= "${options.startDate}"`)
  }
  if (options?.endDate) {
    filters.push(`data_pagamento <= "${options.endDate}"`)
  }
  if (options?.forma && options.forma !== 'all') {
    filters.push(`forma_pagamento = "${options.forma}"`)
  }
  if (options?.unidade && options.unidade !== 'all') {
    filters.push(`unidade = "${options.unidade}"`)
  }
  if (options?.appointmentId) {
    filters.push(`appointment_id = "${options.appointmentId}"`)
  }
  if (options?.contactId) {
    filters.push(`crm_contact_id = "${options.contactId}"`)
  }

  const filterStr = filters.join(' && ')

  try {
    const list = await pb.collection('payments').getFullList<Payment>({
      filter: filterStr || undefined,
      sort: '-data_pagamento',
      expand: 'appointment_id,crm_contact_id,created_by',
      requestKey: null,
    })
    return Array.isArray(list) ? list : []
  } catch (err) {
    if (!isNetworkError(err)) {
      console.warn('[payments] Erro ao listar pagamentos:', err)
    }
    return []
  }
}

/**
 * Busca pagamento vinculado a um agendamento específico.
 */
export async function getPaymentByAppointmentId(appointmentId: string): Promise<Payment | null> {
  if (!appointmentId) return null
  try {
    const list = await pb.collection('payments').getFullList<Payment>({
      filter: `appointment_id = "${appointmentId}"`,
      sort: '-created',
      requestKey: null,
    })
    return list[0] || null
  } catch {
    return null
  }
}

/**
 * Calcula resumo financeiro do mês (receita, ticket médio, por unidade e orçamentos em aberto).
 */
export async function fetchFinancialSummary(accountId: string): Promise<PaymentSummary> {
  const now = new Date()
  const currentYear = now.getFullYear()
  const currentMonth = now.getMonth() // 0-based

  const startOfMonth = new Date(currentYear, currentMonth, 1).toISOString()
  const endOfMonth = new Date(currentYear, currentMonth + 1, 0, 23, 59, 59).toISOString()

  const startOfPrevMonth = new Date(currentYear, currentMonth - 1, 1).toISOString()
  const endOfPrevMonth = new Date(currentYear, currentMonth, 0, 23, 59, 59).toISOString()

  const defaultSummary: PaymentSummary = {
    receitaMesAtual: 0,
    receitaMesAnterior: 0,
    ticketMedioMes: 0,
    totalAtendimentosMes: 0,
    totalPorForma: { pix: 0, cartao: 0, dinheiro: 0, transferencia: 0 },
    totalPorUnidade: {
      'Carmo do Rio Claro': 0,
      Alfenas: 0,
      'Monte Belo': 0,
      Online: 0,
    },
    orcamentosAbertosTotal: 0,
    orcamentosAbertosQtd: 0,
  }

  if (!accountId) return defaultSummary

  try {
    const [mesAtualList, mesAnteriorList, openBudgets] = await Promise.all([
      listPayments({ accountId, startDate: startOfMonth, endDate: endOfMonth }),
      listPayments({ accountId, startDate: startOfPrevMonth, endDate: endOfPrevMonth }),
      pb
        .collection('crm_contacts')
        .getFullList({
          filter: `account_id = "${accountId}" && stage = "orcamento_enviado" && archived != true`,
          requestKey: null,
        })
        .catch(() => []),
    ])

    let receitaAtual = 0
    const porForma: Record<PaymentMethod, number> = {
      pix: 0,
      cartao: 0,
      dinheiro: 0,
      transferencia: 0,
    }
    const porUnidade: Record<string, number> = {
      'Carmo do Rio Claro': 0,
      Alfenas: 0,
      'Monte Belo': 0,
      Online: 0,
    }

    for (const p of mesAtualList) {
      const v = Number(p.valor) || 0
      receitaAtual += v

      if (p.forma_pagamento && porForma[p.forma_pagamento] !== undefined) {
        porForma[p.forma_pagamento] += v
      }
      const u = p.unidade || 'Carmo do Rio Claro'
      porUnidade[u] = (porUnidade[u] || 0) + v
    }

    let receitaAnterior = 0
    for (const p of mesAnteriorList) {
      receitaAnterior += Number(p.valor) || 0
    }

    const totalAtendimentos = mesAtualList.length
    const ticketMedio = totalAtendimentos > 0 ? receitaAtual / totalAtendimentos : 0

    let orcamentosTotal = 0
    for (const b of openBudgets) {
      orcamentosTotal += Number(b.budget_value) || 0
    }

    return {
      receitaMesAtual: Math.round(receitaAtual * 100) / 100,
      receitaMesAnterior: Math.round(receitaAnterior * 100) / 100,
      ticketMedioMes: Math.round(ticketMedio * 100) / 100,
      totalAtendimentosMes: totalAtendimentos,
      totalPorForma: porForma,
      totalPorUnidade: porUnidade,
      orcamentosAbertosTotal: Math.round(orcamentosTotal * 100) / 100,
      orcamentosAbertosQtd: openBudgets.length,
    }
  } catch (err) {
    if (!isNetworkError(err)) {
      console.warn('[financial] Erro ao consolidar resumo financeiro:', err)
    }
    return defaultSummary
  }
}
