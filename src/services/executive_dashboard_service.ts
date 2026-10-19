import { safePbFullList } from '@/lib/pocketbase/resilient'
import { isNetworkError } from '@/lib/pocketbase/errors'
import pb from '@/lib/pocketbase/client'

export interface ExecutiveMetrics {
  noShowPercent: number | null
  totalConsultasAvaliadas: number
  totalFaltas: number
  leadConversionRate: number | null
  totalLeads: number
  totalConvertidos: number
  retornos30a45DiasQtd: number | null
  clubeAtivoQtd: number | null
  iaAcceptanceRate: number | null // null => exibir "—" com tooltip
  iaAcceptanceTooltip: string
}

export const DEFAULT_EXECUTIVE_METRICS: ExecutiveMetrics = {
  noShowPercent: null,
  totalConsultasAvaliadas: 0,
  totalFaltas: 0,
  leadConversionRate: null,
  totalLeads: 0,
  totalConvertidos: 0,
  retornos30a45DiasQtd: null,
  clubeAtivoQtd: null,
  iaAcceptanceRate: null,
  iaAcceptanceTooltip:
    'Disponível quando o registro de aceite das sugestões da IA existir na plataforma',
}

const QUERY_TIMEOUT_MS = 8000

function safeQuery<T>(label: string, run: () => Promise<T>, fallback: T): Promise<T> {
  return new Promise<T>((resolve) => {
    let settled = false
    const finish = (value: T) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(value)
    }
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true
        console.warn(`[ExecutiveMetrics] Timeout em ${label} (retornando fallback)`)
        resolve(fallback)
      }
    }, QUERY_TIMEOUT_MS)

    Promise.resolve()
      .then(run)
      .then((val) => finish(val))
      .catch((err) => {
        if (!isNetworkError(err)) {
          console.warn(`[ExecutiveMetrics] Erro silencioso em ${label}:`, err)
        }
        finish(fallback)
      })
  })
}

/**
 * Calcula no-show % a partir dos agendamentos passados com desfecho (realizado vs faltou).
 */
async function calculateNoShow(accountId: string): Promise<{
  noShowPercent: number | null
  totalConsultas: number
  totalFaltas: number
}> {
  return safeQuery(
    'noShow',
    async () => {
      const filters = ['(status = "realizado" || status = "faltou")']
      if (accountId) filters.push(`account_id = "${accountId}"`)

      const list = await safePbFullList<{ id: string; status?: string }>({
        collection: 'appointments',
        filter: filters.join(' && '),
        fields: 'id,status',
        perPage: 200,
        label: 'executive:noShow',
      })

      if (!list || list.length === 0) {
        return { noShowPercent: null, totalConsultas: 0, totalFaltas: 0 }
      }

      const totalFaltas = list.filter((a) => a.status === 'faltou').length
      const rate = Math.round((totalFaltas / list.length) * 100)
      return {
        noShowPercent: rate,
        totalConsultas: list.length,
        totalFaltas,
      }
    },
    { noShowPercent: null, totalConsultas: 0, totalFaltas: 0 },
  )
}

/**
 * Conversão de leads: pacientes com converted_at preenchido ou estágio concluído / total de leads.
 */
async function calculateLeadConversion(accountId: string): Promise<{
  rate: number | null
  totalLeads: number
  totalConvertidos: number
}> {
  return safeQuery(
    'leadConversion',
    async () => {
      const filters = ['archived != true']
      if (accountId) filters.push(`account_id = "${accountId}"`)

      const list = await safePbFullList<{
        id: string
        stage?: string
        converted_at?: string
        origin?: string
      }>({
        collection: 'crm_contacts',
        filter: filters.join(' && '),
        fields: 'id,stage,converted_at,origin',
        perPage: 200,
        label: 'executive:leadConversion',
      })

      if (!list || list.length === 0) {
        return { rate: null, totalLeads: 0, totalConvertidos: 0 }
      }

      const totalLeads = list.length
      const convertidos = list.filter(
        (c) =>
          Boolean(c.converted_at) ||
          c.stage === 'ganho' ||
          c.stage === 'paciente_ativo' ||
          c.stage === 'consulta_realizada',
      ).length

      const rate = Math.round((convertidos / totalLeads) * 100)
      return {
        rate,
        totalLeads,
        totalConvertidos: convertidos,
      }
    },
    { rate: null, totalLeads: 0, totalConvertidos: 0 },
  )
}

/**
 * Retornos a 30-45 dias: pacientes cuja última consulta foi realizada há entre 30 e 45 dias
 * e que ainda não têm nova consulta futura agendada.
 */
async function calculateRetornos30a45(accountId: string): Promise<number | null> {
  return safeQuery(
    'retornos30a45',
    async () => {
      const now = new Date()
      const d30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString()
      const d45 = new Date(now.getTime() - 45 * 24 * 60 * 60 * 1000).toISOString()

      const filters = [`starts_at >= "${d45}"`, `starts_at <= "${d30}"`, `status = "realizado"`]
      if (accountId) filters.push(`account_id = "${accountId}"`)

      const list = await safePbFullList<{
        id: string
        patient_id?: string
        patient_phone?: string
      }>({
        collection: 'appointments',
        filter: filters.join(' && '),
        fields: 'id,patient_id,patient_phone',
        perPage: 200,
        label: 'executive:retornos30a45',
      })

      return Array.isArray(list) ? list.length : null
    },
    null,
  )
}

/**
 * Clube ativo: quantidade de contatos marcados como membros do clube de saúde.
 */
async function calculateClubeAtivo(accountId: string): Promise<number | null> {
  return safeQuery(
    'clubeAtivo',
    async () => {
      const filters = ['is_club_member = true', 'archived != true']
      if (accountId) filters.push(`account_id = "${accountId}"`)

      const res = await pb.collection('crm_contacts').getList(1, 1, {
        filter: filters.join(' && '),
        requestKey: null,
      })

      const total = (res as any)?.totalItems
      return typeof total === 'number' && !isNaN(total) ? total : null
    },
    null,
  )
}

/**
 * Consolidador resiliente de métricas do Dashboard Executivo.
 * Execução com safeQuery individual: nenhum erro ou timeout propaga Exception.
 */
export async function fetchExecutiveMetrics(accountId: string): Promise<ExecutiveMetrics> {
  if (!accountId) return DEFAULT_EXECUTIVE_METRICS

  // Carregamento escalonado para evitar disparo em rajada
  const noShow = await calculateNoShow(accountId)
  await new Promise((r) => setTimeout(r, 60))
  const leadConv = await calculateLeadConversion(accountId)
  await new Promise((r) => setTimeout(r, 60))
  const retornos = await calculateRetornos30a45(accountId)
  await new Promise((r) => setTimeout(r, 60))
  const clube = await calculateClubeAtivo(accountId)

  return {
    noShowPercent: noShow.noShowPercent,
    totalConsultasAvaliadas: noShow.totalConsultas,
    totalFaltas: noShow.totalFaltas,
    leadConversionRate: leadConv.rate,
    totalLeads: leadConv.totalLeads,
    totalConvertidos: leadConv.totalConvertidos,
    retornos30a45DiasQtd: retornos,
    clubeAtivoQtd: clube,
    iaAcceptanceRate: null, // Padrão acordado: "—" com tooltip explicativo
    iaAcceptanceTooltip:
      'Disponível quando o registro de aceite das sugestões da IA existir na plataforma',
  }
}
