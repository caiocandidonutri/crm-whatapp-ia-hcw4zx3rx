/**
 * Painel de Comando (X-ray) — métricas leves para o cartão da /home.
 *
 * REGRA CRÍTICA DE RESILIÊNCIA: nenhuma consulta aqui pode rejeitar.
 * Cada bloco tem catch individual, timeout próprio e retorna fallback
 * (0 / null). Um 400, isNetworkError ou timeout NUNCA derruba a /home.
 * Nenhum expand pesado (o expand de conversation_id em tasks causou
 * HTTP 400/30s no passado — não reintroduzir).
 */

import pb from '@/lib/pocketbase/client'
import { isNetworkError } from '@/lib/pocketbase/errors'
import { getSaoPauloDateParts } from '@/lib/datetime'
import { getCareAlertSettings } from '@/services/care_alerts_service'
import { isAnyAbortError } from '@/services/tasks'

export interface AutomationsHealth {
  /** null = não foi possível ler agora (estado silencioso, nunca false por falha) */
  globalPaused: boolean | null
  nightShield: boolean
  lastSyncAt: string | null
  lastSyncStatus: string | null
}

export interface CommandCenterMetrics {
  /** null = falha silenciosa; 0 = realmente zero */
  unreadConversations: number | null
  todayAppointments: number | null
  automations: AutomationsHealth
}

export const DEFAULT_COMMAND_CENTER_METRICS: CommandCenterMetrics = {
  unreadConversations: null,
  todayAppointments: null,
  automations: {
    globalPaused: null,
    nightShield: false,
    lastSyncAt: null,
    lastSyncStatus: null,
  },
}

const QUERY_TIMEOUT_MS = 8000

/**
 * Executa uma consulta com timeout próprio e NUNCA rejeita:
 * qualquer erro (rede, 400, abort, timeout) resolve para `fallback`.
 */
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
        console.warn(`[CommandCenter] Timeout em ${label} (retornando fallback)`)
        resolve(fallback)
      }
    }, QUERY_TIMEOUT_MS)

    Promise.resolve()
      .then(run)
      .then((value) => finish(value))
      .catch((err) => {
        if (!isAnyAbortError(err)) {
          const kind = isNetworkError(err) ? 'rede' : 'consulta'
          console.warn(`[CommandCenter] Falha (${kind}) em ${label}:`, err?.message || err)
        }
        finish(fallback)
      })
  })
}

/**
 * Night Shield 21h–07h no fuso da clínica (America/Sao_Paulo).
 */
export function isNightShieldActive(now: Date = new Date()): boolean {
  try {
    const { hour } = getSaoPauloDateParts(now)
    return hour >= 21 || hour < 7
  } catch {
    return false
  }
}

/**
 * Conta conversas não lidas com consulta LEVE: getList(1, 1) e leitura do
 * totalItems (agregado no servidor). Nunca carrega os registros.
 */
async function countUnreadConversations(
  accountId: string | null | undefined,
  signal?: AbortSignal,
): Promise<number | null> {
  return safeQuery(
    'conversas não lidas',
    async () => {
      if (signal?.aborted) return null
      const filters: string[] = ['unread_count > 0']
      if (accountId) filters.push(`account_id = "${accountId}"`)
      const res = await pb.collection('conversations').getList(1, 1, {
        filter: filters.join(' && '),
        requestKey: null,
        signal,
      })
      const total = (res as any)?.totalItems
      return typeof total === 'number' && !isNaN(total) ? total : null
    },
    null,
  )
}

/**
 * Agendamentos de hoje (fuso America/Sao_Paulo), excluindo cancelados.
 * Consulta leve: getList(1, 1) com filtro de janela do dia.
 */
async function countTodayAppointments(
  accountId: string | null | undefined,
  signal?: AbortSignal,
): Promise<number | null> {
  return safeQuery(
    'agendamentos do dia',
    async () => {
      if (signal?.aborted) return null
      const now = new Date()
      const todayParts = getSaoPauloDateParts(now)
      const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000)
      const tomorrowParts = getSaoPauloDateParts(tomorrow)

      const filters: string[] = [
        `starts_at >= "${todayParts.dayKey} 00:00:00.000Z"`,
        `starts_at < "${tomorrowParts.dayKey} 00:00:00.000Z"`,
        `status != "cancelado"`,
      ]
      if (accountId) filters.push(`account_id = "${accountId}"`)

      const res = await pb.collection('appointments').getList(1, 1, {
        filter: filters.join(' && '),
        requestKey: null,
        signal,
      })
      const total = (res as any)?.totalItems
      return typeof total === 'number' && !isNaN(total) ? total : null
    },
    null,
  )
}

/**
 * Última execução de automação via sync_state (chave da sincronia de agenda).
 * Silencioso: registro ausente ou falha => null.
 */
async function getLastSyncState(
  signal?: AbortSignal,
): Promise<{ lastSyncAt: string | null; lastSyncStatus: string | null }> {
  return safeQuery(
    'sync_state',
    async () => {
      if (signal?.aborted) return { lastSyncAt: null, lastSyncStatus: null }
      try {
        const rec = await pb
          .collection('sync_state')
          .getFirstListItem('key = "agenda_sync"', { requestKey: null, signal })
        return {
          lastSyncAt: (rec as any)?.last_sync || null,
          lastSyncStatus: (rec as any)?.last_status || null,
        }
      } catch (err) {
        if (signal?.aborted || isAnyAbortError(err)) {
          return { lastSyncAt: null, lastSyncStatus: null }
        }
        try {
          // Fallback: procura qualquer chave de agenda (nome de chave pode variar)
          const res = await pb.collection('sync_state').getList(1, 10, {
            filter: `key ~ "agenda"`,
            sort: '-updated',
            requestKey: null,
            signal,
          })
          const first = Array.isArray((res as any)?.items) ? (res as any).items[0] : null
          return {
            lastSyncAt: first?.last_sync || null,
            lastSyncStatus: first?.last_status || null,
          }
        } catch {
          return { lastSyncAt: null, lastSyncStatus: null }
        }
      }
    },
    { lastSyncAt: null, lastSyncStatus: null },
  )
}
/**
 * Saúde das automações: kill-switch global (care_alert_settings),
 * Night Shield derivado da hora local e última execução via sync_state.
 */
async function getAutomationsHealth(
  accountId: string | null | undefined,
  signal?: AbortSignal,
): Promise<AutomationsHealth> {
  const nightShield = isNightShieldActive()

  const [settings, sync] = await Promise.all([
    safeQuery(
      'care_alert_settings',
      async () => {
        if (!accountId || signal?.aborted) return null
        return await getCareAlertSettings(accountId)
      },
      null,
    ),
    getLastSyncState(signal),
  ])

  const pausedRaw = (settings as any)?.global_automations_paused
  return {
    globalPaused: typeof pausedRaw === 'boolean' ? pausedRaw : null,
    nightShield,
    lastSyncAt: sync.lastSyncAt,
    lastSyncStatus: sync.lastSyncStatus,
  }
}

/**
 * Carrega todas as métricas do Painel de Comando.
 * Cada consulta falha de forma independente e silenciosa (fallback null/0).
 */
export async function fetchCommandCenterMetrics(
  accountId: string | null | undefined,
  signal?: AbortSignal,
): Promise<CommandCenterMetrics> {
  // Carregamento escalonado (staggered) para evitar rajada simultânea de requisições
  const unreadConversations = await countUnreadConversations(accountId, signal)
  if (signal?.aborted) return DEFAULT_COMMAND_CENTER_METRICS

  await new Promise((r) => setTimeout(r, 60))
  const todayAppointments = await countTodayAppointments(accountId, signal)
  if (signal?.aborted) return DEFAULT_COMMAND_CENTER_METRICS

  await new Promise((r) => setTimeout(r, 60))
  const automations = await getAutomationsHealth(accountId, signal)

  return { unreadConversations, todayAppointments, automations }
}
