import { useState, useEffect, useCallback, useRef } from 'react'
import pb from '@/lib/pocketbase/client'
import { useRealtime } from '@/hooks/use-realtime'
import { WhatsappInstance, Conversation, WhatsappMessage } from '@/types/models'
import { useAuth } from '@/hooks/use-auth'
import { useCurrentAccount } from '@/hooks/use-current-account'
import { fazerBackfillTimestamps } from '@/services/whatsapp_service'
import type { RecordSubscription } from 'pocketbase'

// Tamanho da página da chat list. 50 cobre praticamente toda a primeira tela
// e mantém o payload pequeno.
const CONVERSATION_PAGE_SIZE = 50
// Pausa entre fetches em background. Evita estourar rate limit do Skip
// quando há muitas páginas (ex.: 500 conversas = 10 páginas).
const BACKGROUND_PAGE_DELAY_MS = 250

function isAbort(err: unknown): boolean {
  return !!(err && typeof err === 'object' && (err as { isAbort?: boolean }).isAbort === true)
}

function sortByLastMessageTs(arr: Conversation[]): Conversation[] {
  return [...arr].sort((a, b) => {
    const aTs =
      a.last_message_timestamp && a.last_message_timestamp > 0 ? a.last_message_timestamp : 0
    const bTs =
      b.last_message_timestamp && b.last_message_timestamp > 0 ? b.last_message_timestamp : 0
    if (bTs !== aTs) return bTs - aTs
    // Empate (ambos sem ts real, ex.: convs pré-backfill): desempata por
    // `created` desc — estável e não oscila quando o webhook salva.
    // Antes o fallback era `updated`, que muda a cada save e fazia a lista
    // pular sozinha durante import.
    const aCreated = a.created || ''
    const bCreated = b.created || ''
    return bCreated.localeCompare(aCreated)
  })
}

function mergeConversations(prev: Conversation[], next: Conversation[]): Conversation[] {
  const map = new Map<string, Conversation>()
  for (const c of prev) map.set(c.id, c)
  for (const c of next) map.set(c.id, c) // página nova sobrescreve em caso de update
  return sortByLastMessageTs(Array.from(map.values()))
}

/**
 * Aplica um evento realtime do PocketBase ao state local de conversations,
 * SEM refetch. Filtra por escopo (user_id + instance_name + archived) pra
 * evitar leak de outras instâncias e respeitar o filtro de arquivadas.
 * Reordena por `last_message_timestamp` a cada update.
 *
 * Edge dos arquivados: se a conv passou a ter archived=true e o front está
 * mostrando apenas não-arquivadas (showArchived=false), removemos do state
 * — caso contrário ela apareceria na lista mesmo "arquivada". Inversa para
 * showArchived=true.
 */
function applyConversationEvent(
  prev: Conversation[],
  e: RecordSubscription<Conversation>,
  scope: { accountId: string; instanceName: string; showArchived: boolean },
): Conversation[] {
  const rec = e.record
  if (!rec || rec.account_id !== scope.accountId || rec.instance_name !== scope.instanceName) {
    return prev
  }
  if (e.action === 'delete') {
    return prev.filter((c) => c.id !== rec.id)
  }
  // Filtro de archived: se o estado da conv não bate com o que estamos
  // mostrando, removemos do state (se estava lá). Trata `null/undefined`
  // como `false` (compatibilidade com convs antes da migration 0022).
  const isArchived = rec.archived === true
  if (isArchived !== scope.showArchived) {
    return prev.filter((c) => c.id !== rec.id)
  }
  // create | update — Map upsert + resort
  const map = new Map(prev.map((c) => [c.id, c]))
  map.set(rec.id, rec)
  return sortByLastMessageTs(Array.from(map.values()))
}

/**
 * Aplica um evento realtime ao state local de mensagens. Mantém ordem
 * crescente por `timestamp` (igual ao sort do load inicial).
 */
function applyMessageEvent(
  prev: WhatsappMessage[],
  e: RecordSubscription<WhatsappMessage>,
  scope: { accountId: string; instanceName: string; remoteJid: string },
): WhatsappMessage[] {
  const rec = e.record
  if (
    !rec ||
    rec.account_id !== scope.accountId ||
    rec.instance_name !== scope.instanceName ||
    rec.remote_jid !== scope.remoteJid
  ) {
    return prev
  }
  if (e.action === 'delete') {
    return prev.filter((m) => m.id !== rec.id)
  }
  const map = new Map(prev.map((m) => [m.id, m]))
  map.set(rec.id, rec)
  return Array.from(map.values()).sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0))
}

export function useInstanciaAtiva() {
  const { user } = useAuth()
  const { accountId } = useCurrentAccount()
  const [instance, setInstance] = useState<WhatsappInstance | null>(null)
  const [loading, setLoading] = useState(true)
  const abortRef = useRef<AbortController | null>(null)

  const load = useCallback(async () => {
    if (!user || !accountId) {
      setInstance(null)
      setLoading(false)
      return
    }
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    try {
      const records = await pb.collection('whatsapp_instances').getFullList<WhatsappInstance>({
        filter: `account_id = "${accountId}"`,
        sort: '-created',
        signal: ctrl.signal,
      })
      const connected = records.find((r) => r.status === 'connected')
      setInstance(connected || records[0] || null)
    } catch (e) {
      if (isAbort(e)) return
      console.error(e)
      setInstance(null)
    } finally {
      if (!ctrl.signal.aborted) setLoading(false)
    }
  }, [user, accountId])

  useEffect(() => {
    load()
    return () => abortRef.current?.abort()
  }, [load])

  // Realtime: patcheia o instance ativo direto do evento. Se não bate com o
  // user logado ou se o evento é de outra instância (não a ativa), ignora.
  // Edge: se o evento cria uma instância NOVA conectada e o user não tinha
  // nenhuma ativa antes, adotamos a nova.
  useRealtime<WhatsappInstance>(
    'whatsapp_instances',
    (e) => {
      if (!user || !accountId || !e.record) return
      if (e.record.account_id !== accountId) return
      if (e.action === 'delete') {
        setInstance((prev) => (prev?.id === e.record.id ? null : prev))
        return
      }
      setInstance((prev) => {
        // Mesma instância: aplica update direto.
        if (prev?.id === e.record.id) return e.record
        // Nenhuma ativa OU a ativa não está conectada: prefere a que veio se
        // ela está conectada.
        if (!prev || prev.status !== 'connected') {
          if (e.record.status === 'connected') return e.record
        }
        return prev
      })
    },
    !!user && !!accountId,
  )

  return { instance, loading, reload: load }
}

export function useConversas(
  instanceName?: string,
  isImporting: boolean = false,
  showArchived: boolean = false,
) {
  const { user } = useAuth()
  const { accountId } = useCurrentAccount()
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const [currentPage, setCurrentPage] = useState(1)
  const backfillTriedRef = useRef(false)
  const abortRef = useRef<AbortController | null>(null)

  const load = useCallback(async () => {
    if (!user || !accountId || !instanceName) {
      setConversations([])
      setLoading(false)
      return
    }

    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    // Filter server-side: por padrão só convs não arquivadas. Quando o user
    // ativa o toggle "Mostrar arquivadas", inverte. `archived = null` (legado,
    // antes da migration 0022) é tratado como false.
    const archivedClause = showArchived
      ? `archived = true`
      : `(archived = false || archived = null)`
    const filter = `account_id = "${accountId}" && instance_name = "${instanceName}" && ${archivedClause}`

    try {
      // Página 1 (50 mais recentes). Sort server-side por
      // `-last_message_timestamp,-created`: o primeiro garante a ordem real
      // do WhatsApp; o segundo é fallback estável (não muda em saves) para
      // convs ainda sem ts real (pré-backfill).
      const firstPage = await pb
        .collection('conversations')
        .getList<Conversation>(1, CONVERSATION_PAGE_SIZE, {
          filter,
          sort: '-last_message_timestamp,-created',
          signal: ctrl.signal,
        })

      if (ctrl.signal.aborted) return

      const sortedFirst = sortByLastMessageTs(firstPage.items)
      setConversations(sortedFirst)
      setCurrentPage(1)
      setHasMore(firstPage.totalPages > 1)
      setLoading(false) // user já pode interagir com as 50 mais recentes

      const totalItems = firstPage.totalItems
      const totalPages = firstPage.totalPages
      const missingTs = sortedFirst.filter(
        (r) => !r.last_message_timestamp || r.last_message_timestamp === 0,
      ).length

      console.log(
        `[useConversas] página 1: ${sortedFirst.length}/${totalItems} (${totalPages} págs total)` +
          (missingTs > 0
            ? `, ${missingTs} sem ts real nesta página`
            : `, ordem reflete horário real do WhatsApp ✅`),
      )

      // Auto-backfill: 1x por sessão, e SÓ fora de import. Em erro, não
      // retentamos — o cron `backfill_conv_timestamps` do PocketBase resolve
      // sem precisar do front.
      if (missingTs > 0 && !backfillTriedRef.current && !isImporting) {
        backfillTriedRef.current = true
        fazerBackfillTimestamps()
          .then((res) => {
            console.log(
              `[useConversas] backfill: ${res.updated} atualizadas, ${res.pending_after} ainda sem ts`,
            )
            // Não dispara load() automaticamente — realtime já vai entregar
            // os updates via applyConversationEvent.
          })
          .catch((err) => {
            console.warn(
              '[useConversas] backfill falhou (cron resolverá em até 1min):',
              err?.message || err,
            )
          })
      }

      setLoadingMore(false)
    } catch (e) {
      if (isAbort(e)) return
      console.error('[useConversas] erro ao carregar conversas:', e)
      setConversations([])
      setLoading(false)
      setLoadingMore(false)
    }
  }, [user, accountId, instanceName, isImporting, showArchived])

  const loadMore = useCallback(async () => {
    if (!user || !accountId || !instanceName || loadingMore || !hasMore) return
    setLoadingMore(true)
    try {
      const nextPage = currentPage + 1
      const archivedClause = showArchived
        ? `archived = true`
        : `(archived = false || archived = null)`
      const filter = `account_id = "${accountId}" && instance_name = "${instanceName}" && ${archivedClause}`

      const next = await pb
        .collection('conversations')
        .getList<Conversation>(nextPage, CONVERSATION_PAGE_SIZE, {
          filter,
          sort: '-last_message_timestamp,-created',
        })

      setConversations((prev) => mergeConversations(prev, next.items))
      setCurrentPage(nextPage)
      setHasMore(nextPage < next.totalPages)
    } catch (err) {
      if (!isAbort(err)) {
        console.warn(`[useConversas] falha ao carregar mais:`, err)
      }
    } finally {
      setLoadingMore(false)
    }
  }, [user, accountId, instanceName, showArchived, loadingMore, hasMore, currentPage])

  useEffect(() => {
    const handler = () => loadMore()
    document.addEventListener('triggerLoadMoreConversations', handler)
    return () => document.removeEventListener('triggerLoadMoreConversations', handler)
  }, [loadMore])

  useEffect(() => {
    document.dispatchEvent(
      new CustomEvent('whatsapp-pagination', { detail: { hasMore, loadingMore } }),
    )
  }, [hasMore, loadingMore])

  const reload = useCallback(() => {
    backfillTriedRef.current = false
    return load()
  }, [load])

  useEffect(() => {
    load()
    return () => abortRef.current?.abort()
  }, [load])

  useEffect(() => {
    backfillTriedRef.current = false
  }, [user?.id, accountId, instanceName, showArchived])

  // Realtime entrega o record completo no evento. Coalesce de 500ms:
  // bufferiza eventos e aplica em um único setState ao final da janela.
  //
  // Por que 500ms: durante import histórico, o webhook processa um batch
  // de até 500 mensagens em sequência e cada msg "newer" gera um save em
  // conversations → 1 evento SSE → 1 setState + sort. Sem buffer, virava
  // 300+ rerenders/seg, lista piscando, impossível clicar. Com buffer,
  // o mesmo batch entrega ~2 setStates/seg.
  //
  // 500ms é ainda imperceptível para o caso normal (msg avulsa chegando)
  // e drasticamente mais barato durante import.
  const eventBufferRef = useRef<RecordSubscription<Conversation>[]>([])
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Garante flush e cancelamento do timer ao desmontar / trocar scope.
  useEffect(() => {
    return () => {
      if (flushTimerRef.current) {
        clearTimeout(flushTimerRef.current)
        flushTimerRef.current = null
      }
      eventBufferRef.current = []
    }
  }, [accountId, instanceName])

  useRealtime<Conversation>(
    'conversations',
    (e) => {
      if (!accountId || !instanceName) return
      eventBufferRef.current.push(e)
      if (flushTimerRef.current !== null) return
      flushTimerRef.current = setTimeout(() => {
        flushTimerRef.current = null
        const events = eventBufferRef.current
        eventBufferRef.current = []
        if (events.length === 0) return
        const scope = { accountId, instanceName, showArchived }
        setConversations((prev) => {
          let next = prev
          for (const evt of events) {
            next = applyConversationEvent(next, evt, scope)
          }
          return next
        })
      }, 500)
    },
    !!accountId && !!instanceName,
  )

  return { conversations, loading, loadingMore, hasMore, loadMore, reload }
}

export function useMensagens(
  instanceName?: string,
  remoteJid?: string,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- mantida pra
  // compat de chamadores; comportamento anti-flood agora vem do event-patching
  _isImporting: boolean = false,
) {
  const { user } = useAuth()
  const { accountId } = useCurrentAccount()
  const [messages, setMessages] = useState<WhatsappMessage[]>([])
  const [loading, setLoading] = useState(true)
  const abortRef = useRef<AbortController | null>(null)

  const load = useCallback(async () => {
    if (!user || !accountId || !instanceName || !remoteJid) {
      setMessages([])
      setLoading(false)
      return
    }
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    try {
      const records = await pb.collection('whatsapp_messages').getFullList<WhatsappMessage>({
        filter: `account_id = "${accountId}" && instance_name = "${instanceName}" && remote_jid = "${remoteJid}"`,
        sort: 'timestamp',
        signal: ctrl.signal,
      })
      if (ctrl.signal.aborted) return
      setMessages(records)
    } catch (e) {
      if (isAbort(e)) return
      console.error(e)
    } finally {
      if (!ctrl.signal.aborted) setLoading(false)
    }
  }, [user, accountId, instanceName, remoteJid])

  useEffect(() => {
    load()
    return () => abortRef.current?.abort()
  }, [load])

  // Realtime patcheia state. Antes, cada msg que chegava em sync disparava
  // refresh() throttled → getFullList de TODAS as msgs da conversa. Em uma
  // conversa com 5k mensagens, isso era catastrófico.
  useRealtime<WhatsappMessage>(
    'whatsapp_messages',
    (e) => {
      if (!accountId || !instanceName || !remoteJid) return
      setMessages((prev) => applyMessageEvent(prev, e, { accountId, instanceName, remoteJid }))
    },
    !!accountId && !!instanceName && !!remoteJid,
  )

  return { messages, loading, reload: load }
}
