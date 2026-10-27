import React, { useState, useEffect, useMemo, useCallback } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  ListFilter,
  Search,
  CheckCircle2,
  Clock,
  AlertTriangle,
  MessageSquare,
  RefreshCw,
  Phone,
  Sparkles,
  ArrowUpDown,
  Building2,
  Calendar,
  ExternalLink,
  ShieldCheck,
  Check,
  RotateCcw,
} from 'lucide-react'
import { toast } from 'sonner'
import pb from '@/lib/pocketbase/client'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { useCurrentAccount } from '@/hooks/use-current-account'
import { useRealtime } from '@/hooks/use-realtime'
import { formatPhoneBR } from '@/lib/phone'
import { safePbFullList, safePbFullListWithStatus } from '@/lib/pocketbase/resilient'
import { isNetworkError, isRateLimitError } from '@/lib/pocketbase/errors'
import { getCareAlertSettings, setPlantaoFimDeSemana } from '@/services/care_alerts_service'
import { fetchHomeMetrics, type HomeMetricsData } from '@/services/home_metrics'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import type { CrmContact, Conversation, Task } from '@/types/models'
import {
  getDayKeySaoPaulo,
  parseToDate,
  formatTimeSaoPaulo,
  formatBrazilianDate,
} from '@/lib/datetime'

export type FilaStatus =
  | 'PRECISA_DE_MENSAGEM'
  | 'AGUARDANDO_RESPOSTA'
  | 'EM_NEGOCIACAO'
  | 'ALERTA'
  | 'NAO_PRECISA'

export interface FilaItem {
  id: string
  contactId: string
  name: string
  phone: string
  formattedPhone: string
  instanceName: string
  unidade: string
  stageKey: string
  stageLabel: string
  lastContactAt: Date | null
  lastContactWho: 'cliente' | 'equipe' | 'desconhecido'
  status: FilaStatus
  statusLabel: string
  priority: 'alta' | 'media' | 'baixa' | 'urgente'
  priorityScore: number
  suggestedAction: string
  completedToday: boolean
  completedAt?: string
  budget?: number
  isPatient?: boolean
  isClubMember?: boolean
  planExpiresAt?: string
  hasOpenTask?: boolean
  taskTitle?: string
}

const STATUS_CONFIG: Record<
  FilaStatus,
  { label: string; badgeClass: string; rowBg?: string; dotClass: string }
> = {
  PRECISA_DE_MENSAGEM: {
    label: 'PRECISA DE MENSAGEM',
    badgeClass:
      'bg-emerald-50 text-emerald-800 border-emerald-300 dark:bg-emerald-950/40 dark:text-emerald-300',
    dotClass: 'bg-emerald-500',
  },
  ALERTA: {
    label: 'ALERTA',
    badgeClass: 'bg-rose-50 text-rose-800 border-rose-300 dark:bg-rose-950/40 dark:text-rose-300',
    dotClass: 'bg-rose-500',
  },
  EM_NEGOCIACAO: {
    label: 'EM NEGOCIAÇÃO',
    badgeClass:
      'bg-purple-50 text-purple-800 border-purple-300 dark:bg-purple-950/40 dark:text-purple-300',
    dotClass: 'bg-purple-500',
  },
  AGUARDANDO_RESPOSTA: {
    label: 'AGUARDANDO RESPOSTA',
    badgeClass:
      'bg-amber-50 text-amber-800 border-amber-300 dark:bg-amber-950/40 dark:text-amber-300',
    dotClass: 'bg-amber-500',
  },
  NAO_PRECISA: {
    label: 'NÃO PRECISA',
    badgeClass: 'bg-slate-50 text-slate-700 border-slate-300 dark:bg-slate-900 dark:text-slate-300',
    dotClass: 'bg-slate-400',
  },
}

const STAGE_LABELS: Record<string, string> = {
  lead: 'Lead',
  em_atendimento: 'Em atendimento',
  orcamento_enviado: 'Orçamento Enviado',
  cliente: 'Cliente',
  perdido: 'Perdido',
  nao_respondido: 'Não Respondidos',
}

const PRIORITY_SCORES: Record<string, number> = {
  urgente: 400,
  alta: 300,
  media: 200,
  baixa: 100,
}

function getDoneStorageKey(accountId: string) {
  const todayKey = getDayKeySaoPaulo(new Date())
  return `crm_fila_done_${accountId}_${todayKey}`
}

function loadDoneSet(accountId?: string): Set<string> {
  if (!accountId) return new Set()
  try {
    const raw = localStorage.getItem(getDoneStorageKey(accountId))
    if (!raw) return new Set()
    const arr = JSON.parse(raw)
    return new Set(Array.isArray(arr) ? arr : [])
  } catch {
    return new Set()
  }
}

function saveDoneSet(accountId: string, set: Set<string>) {
  try {
    localStorage.setItem(getDoneStorageKey(accountId), JSON.stringify(Array.from(set)))
  } catch {
    // quota ou bloqueio silencioso
  }
}

export default function FilaDoDia() {
  const navigate = useNavigate()
  const { accountId, error: accountError } = useCurrentAccount()

  const [metrics, setMetrics] = useState<HomeMetricsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [contacts, setContacts] = useState<CrmContact[]>([])
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [tasks, setTasks] = useState<Task[]>([])
  const [tasksDegraded, setTasksDegraded] = useState(false)
  const [doneTodayIds, setDoneTodayIds] = useState<Set<string>>(() => loadDoneSet(accountId))

  // Configuração do Modo Plantão (fim de semana)
  const [plantaoFimDeSemana, setPlantaoFimDeSemanaState] = useState<boolean>(false)
  const [salvandoPlantao, setSalvandoPlantao] = useState<boolean>(false)
  const [abaFimDeSemanaAtiva, setAbaFimDeSemanaAtiva] = useState<boolean>(false)

  // Carrega configuração de plantao_fim_de_semana com debounce / fallback seguro
  useEffect(() => {
    let cancel = false
    async function carregarPlantao() {
      if (!accountId) return
      try {
        const settings = await getCareAlertSettings(accountId)
        if (!cancel && settings) {
          setPlantaoFimDeSemanaState(Boolean(settings.plantao_fim_de_semana))
        }
      } catch (err) {
        // Ignora silenciosamente em caso de rate-limit
      }
    }
    const t = setTimeout(carregarPlantao, 120)
    return () => {
      cancel = true
      clearTimeout(t)
    }
  }, [accountId])

  const handleTogglePlantao = async (novoValor: boolean) => {
    if (!accountId || salvandoPlantao) return
    setSalvandoPlantao(true)
    try {
      await setPlantaoFimDeSemana(accountId, novoValor)
      setPlantaoFimDeSemanaState(novoValor)
      toast.success(
        novoValor
          ? 'Modo Plantão ativado: IA responderá dúvidas básicas sáb/dom'
          : 'Modo Plantão desativado',
      )
    } catch (err: any) {
      console.error('[FilaDoDia] Erro ao alternar Modo Plantão:', err)
      toast.error('Erro ao atualizar Modo Plantão')
    } finally {
      setSalvandoPlantao(false)
    }
  }

  // Filtros
  const [searchTerm, setSearchTerm] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [stageFilter, setStageFilter] = useState<string>('all')
  const [unidadeFilter, setUnidadeFilter] = useState<string>('all')
  const [showOnlyPendingToday, setShowOnlyPendingToday] = useState(true)
  const [sortField, setSortField] = useState<'priority' | 'lastContact' | 'name'>('priority')
  const [sortAsc, setSortAsc] = useState(false)

  // Atualiza cache de "concluído hoje" se a conta mudar
  useEffect(() => {
    if (accountId) {
      setDoneTodayIds(loadDoneSet(accountId))
    }
  }, [accountId])

  const [loadError, setLoadError] = useState<string | null>(null)
  const [lastLoadedAt, setLastLoadedAt] = useState<Date | null>(null)

  const loadData = useCallback(async () => {
    if (!accountId) {
      setLoading(false)
      if (accountError) {
        setLoadError('Não foi possível carregar a conta atual. Tentar de novo.')
      }
      return
    }
    setLoading(true)
    setLoadError(null)

    try {
      // 1. Contatos CRM (payload leve, sem expand, com detecção explícita de falha)
      const contactsRes = await safePbFullListWithStatus<CrmContact>({
        collection: 'crm_contacts',
        filter: `account_id = "${accountId}" && archived != true`,
        sort: '-updated',
        perPage: 200,
        label: 'FilaDoDia:contacts',
      })

      await new Promise((r) => setTimeout(r, 100))

      // 2. Conversas ativas
      const convsRes = await safePbFullListWithStatus<Conversation>({
        collection: 'conversations',
        filter: `account_id = "${accountId}" && archived != true`,
        sort: '-last_message_timestamp',
        perPage: 200,
        label: 'FilaDoDia:conversations',
      })

      await new Promise((r) => setTimeout(r, 100))

      // 3. Tarefas abertas (sem expand para evitar broken pipe; perPage 100)
      const tasksRes = await safePbFullListWithStatus<Task>({
        collection: 'tasks',
        filter: `account_id = "${accountId}" && status != "concluida" && status != "cancelada" && status != "resolvida_auto"`,
        sort: '-created',
        perPage: 100,
        label: 'FilaDoDia:tasks',
      })

      // Se todas as fontes falharam, ou se os contatos do CRM falharam (fonte principal da fila)
      if (contactsRes.failed && tasksRes.failed) {
        setLoadError('Não foi possível carregar. Tentar de novo')
        return
      }

      if (contactsRes.failed && contacts.length === 0) {
        setLoadError('Não foi possível carregar os contatos. Tentar de novo')
        return
      }

      if (Array.isArray(contactsRes.items) && contactsRes.items.length > 0) {
        setContacts(contactsRes.items)
      }
      if (Array.isArray(convsRes.items)) {
        setConversations(convsRes.items)
      }
      if (Array.isArray(tasksRes.items)) {
        setTasks(tasksRes.items)
      }
      setTasksDegraded(tasksRes.failed)
      setLastLoadedAt(new Date())

      // Carrega métricas agregadas de SLA e não lidas
      try {
        const mData = await fetchHomeMetrics()
        setMetrics(mData)
      } catch {
        /* intentionally ignored */
      }
    } catch (err) {
      console.warn('[FilaDoDia] Erro ao carregar dados:', err)
      if (contacts.length === 0) {
        setLoadError('Não foi possível carregar. Tentar de novo')
      }
    } finally {
      setLoading(false)
    }
  }, [accountId, accountError, contacts.length])

  useEffect(() => {
    loadData()
  }, [loadData])

  // Assinaturas realtime com debounce para não disparar rajadas
  const debouncedReloadTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const scheduleReload = useCallback(() => {
    if (debouncedReloadTimerRef.current) {
      clearTimeout(debouncedReloadTimerRef.current)
    }
    debouncedReloadTimerRef.current = setTimeout(() => {
      loadData()
    }, 1500)
  }, [loadData])

  useRealtime('crm_contacts', scheduleReload, !!accountId)
  useRealtime('conversations', scheduleReload, !!accountId)
  useRealtime('tasks', scheduleReload, !!accountId)

  // Mapas auxiliares para busca O(1) com guardas estritas
  const convByJid = useMemo(() => {
    const map = new Map<string, Conversation>()
    if (!Array.isArray(conversations)) return map
    for (const c of conversations) {
      if (!c) continue
      if (c.remote_jid && typeof c.remote_jid === 'string') {
        map.set(c.remote_jid, c)
      }
      if (c.contact_phone && typeof c.contact_phone === 'string') {
        const clean = c.contact_phone.replace(/\D/g, '')
        if (clean) map.set(clean, c)
      }
    }
    return map
  }, [conversations])

  const tasksByContactId = useMemo(() => {
    const map = new Map<string, Task[]>()
    if (!Array.isArray(tasks)) return map
    for (const t of tasks) {
      if (!t) continue
      if (t.crm_contact_id && typeof t.crm_contact_id === 'string') {
        if (!map.has(t.crm_contact_id)) map.set(t.crm_contact_id, [])
        map.get(t.crm_contact_id)!.push(t)
      }
    }
    return map
  }, [tasks])

  // Derivação estrita da fila a partir dos dados existentes com blindagem total contra nulos/indefinidos
  const queueItems: FilaItem[] = useMemo(() => {
    if (!Array.isArray(contacts)) return []

    return contacts
      .filter((c): c is CrmContact => Boolean(c && typeof c === 'object' && c.id))
      .map((c) => {
        try {
          const rawJid = String(c.jid || '').trim()
          const rawPhone = String(c.phone || '').trim()
          const cleanPhone = (rawPhone || rawJid).replace(/\D/g, '')
          const conv =
            (rawJid ? convByJid.get(rawJid) : undefined) ||
            (cleanPhone ? convByJid.get(cleanPhone) : undefined)
          const contactTasks = (c.id ? tasksByContactId.get(c.id) : undefined) || []
          const hasOpenTask = contactTasks.length > 0
          const openTaskTitle = contactTasks[0]?.title ? String(contactTasks[0].title) : ''

          // Identificação da última mensagem / contato de forma blindada
          let lastContactAt: Date | null = null
          let lastContactWho: 'cliente' | 'equipe' | 'desconhecido' = 'desconhecido'

          if (conv?.last_message_timestamp) {
            const ts = Number(conv.last_message_timestamp)
            if (!isNaN(ts) && ts > 0) {
              const ms = ts > 1e12 ? ts : ts * 1000
              const parsed = new Date(ms)
              if (!isNaN(parsed.getTime())) {
                lastContactAt = parsed
              }
            }
          }
          if (!lastContactAt && c.last_synced_at) {
            lastContactAt = parseToDate(c.last_synced_at)
          }
          if (!lastContactAt && c.updated) {
            lastContactAt = parseToDate(c.updated)
          }

          // Se temos unread_count > 0, o cliente mandou mensagem e aguarda retorno
          const unreadCount = Number(conv?.unread_count) || 0
          const hasUnreadFromClient = unreadCount > 0
          if (hasUnreadFromClient) {
            lastContactWho = 'cliente'
          }

          // Cálculo de Status da Fila usando care_state único da clínica
          // REGRA DO USUÁRIO: só "responder" gera alerta. "atendido_a_fechar" nunca é alerta.
          let status: FilaStatus = 'NAO_PRECISA'
          let suggestedAction =
            String(c.ai_suggested_action || c.care_state_reason || '').trim() ||
            'Manter contato ativo conforme necessidade clínica.'

          const stageKey = String(c.stage || 'lead')
            .trim()
            .toLowerCase()
          const careState = String(c.care_state || '')
            .trim()
            .toLowerCase()
          const isAlertActive = c.alert_active === true || careState === 'responder'

          if (isAlertActive || careState === 'responder') {
            status = 'ALERTA'
            suggestedAction =
              c.care_state_reason ||
              'Mensagem do paciente sem resposta — responder com acolhimento.'
          } else if (careState === 'atendido_a_fechar') {
            // "atendido_a_fechar" nunca é alerta: consulta do dia com horário passado aguardando fechamento humano
            status = 'AGUARDANDO_RESPOSTA'
            suggestedAction =
              c.care_state_reason || 'Consulta realizada hoje — aguardando fechamento na recepção.'
          } else if (careState === 'confirmacao_enviada') {
            status = 'AGUARDANDO_RESPOSTA'
            suggestedAction = c.care_state_reason || 'Confirmação/lembrete enviado nas últimas 48h.'
          } else if (careState === 'agendado') {
            status = 'NAO_PRECISA'
            suggestedAction = c.care_state_reason || 'Consulta futura confirmada/agendada.'
          } else if (careState === 'retorno_a_oferecer') {
            status = 'PRECISA_DE_MENSAGEM'
            suggestedAction =
              c.care_state_reason || 'Paciente sem novo agendamento — oferecer retorno/consulta.'
          } else if (careState === 'inativo') {
            status = 'NAO_PRECISA'
            suggestedAction = c.care_state_reason || 'Lead sem resposta há mais de 30 dias.'
          } else if (careState === 'contatado') {
            status = 'AGUARDANDO_RESPOSTA'
            suggestedAction = c.care_state_reason || 'Clínica respondeu recentemente.'
          } else if (stageKey === 'orcamento_enviado') {
            status = 'EM_NEGOCIACAO'
            suggestedAction = 'Acompanhar proposta enviada.'
          } else if (hasUnreadFromClient) {
            status = 'ALERTA'
            suggestedAction = 'Mensagem nova não respondida — responder e acolher.'
          }

          // Prioridade numérica (para ordenação)
          let priorityScore = 100
          let priority: 'baixa' | 'media' | 'alta' | 'urgente' = 'media'

          const aiPriorityNum = Number(c.ai_priority)
          if (!isNaN(aiPriorityNum) && aiPriorityNum > 0) {
            priorityScore += aiPriorityNum * 10
          }

          if (status === 'ALERTA') {
            priorityScore += 300
            priority = 'urgente'
          } else if (status === 'PRECISA_DE_MENSAGEM') {
            priorityScore += 200
            priority = 'alta'
          } else if (status === 'EM_NEGOCIACAO') {
            priorityScore += 150
            priority = 'alta'
          } else if (status === 'AGUARDANDO_RESPOSTA') {
            priorityScore += 80
            priority = 'media'
          } else {
            priorityScore += 20
            priority = 'baixa'
          }

          // Se tem tarefa de alta prioridade aberta
          if (
            hasOpenTask &&
            contactTasks.some((t) => t?.priority === 'alta' || t?.priority === 'urgente')
          ) {
            priorityScore += 100
            priority = 'urgente'
          }

          const isCompletedToday = Boolean(c.id && doneTodayIds.has(c.id))

          // Identificação da Unidade
          const notesStr = String(c.notes || '').toLowerCase()
          let unidade = 'Carmo do Rio Claro'
          if (notesStr.includes('alfenas')) unidade = 'Alfenas'
          else if (notesStr.includes('monte belo')) unidade = 'Monte Belo'
          else if (notesStr.includes('online')) unidade = 'Online'

          const displayName =
            (typeof c.contact_name === 'string' && c.contact_name.trim()) ||
            (typeof c.push_name === 'string' && c.push_name.trim()) ||
            (rawPhone ? formatPhoneBR(rawPhone) : 'Sem Nome')
          const formattedPhone = formatPhoneBR(rawPhone || rawJid) || rawPhone || rawJid

          const cfg = STATUS_CONFIG[status] || STATUS_CONFIG.NAO_PRECISA

          const budgetVal =
            typeof c.budget_value === 'number' ? c.budget_value : Number(c.budget_value) || 0

          return {
            id: String(c.id),
            contactId: String(c.id),
            name: displayName,
            phone: rawPhone || rawJid,
            formattedPhone,
            instanceName: String(c.instance_name || 'Principal'),
            unidade,
            stageKey,
            stageLabel: STAGE_LABELS[stageKey] || stageKey,
            lastContactAt,
            lastContactWho,
            status,
            statusLabel: cfg.label,
            priority,
            priorityScore,
            suggestedAction,
            completedToday: isCompletedToday,
            budget: budgetVal,
            isPatient: Boolean(c.is_patient),
            isClubMember: Boolean(c.is_club_member),
            planExpiresAt: c.plan_expires_at || undefined,
            hasOpenTask,
            taskTitle: openTaskTitle,
          }
        } catch (itemErr) {
          console.warn('[FilaDoDia] Contato corrompido neutralizado:', c?.id, itemErr)
          return null
        }
      })
      .filter((item): item is FilaItem => item !== null)
  }, [contacts, convByJid, tasksByContactId, doneTodayIds])

  // Alterna o status "concluído hoje" para a secretária Fabiana
  const toggleDoneToday = (contactId: string, name: string) => {
    if (!accountId || !contactId) return
    setDoneTodayIds((prev) => {
      const next = new Set(prev)
      const isNowDone = !next.has(contactId)
      if (isNowDone) {
        next.add(contactId)
        toast.success(`Atendimento de ${name || 'Contato'} marcado como concluído hoje!`)
      } else {
        next.delete(contactId)
        toast.info(`Marcação de ${name || 'Contato'} removida.`)
      }
      saveDoneSet(accountId, next)
      return next
    })
  }

  // Filtragem e Ordenação com proteção total contra nulos
  const filteredItems = useMemo(() => {
    if (!Array.isArray(queueItems)) return []
    return queueItems
      .filter((item) => {
        if (!item) return false
        // Filtro de concluídos hoje
        if (showOnlyPendingToday && item.completedToday) return false

        // Filtro de texto
        if (searchTerm.trim()) {
          const q = searchTerm.toLowerCase().trim()
          const cleanQ = q.replace(/\D/g, '')
          const matchName = (item.name || '').toLowerCase().includes(q)
          const matchPhone =
            (item.phone || '').toLowerCase().includes(q) ||
            (cleanQ.length >= 4 && (item.phone || '').includes(cleanQ))
          const matchAction = (item.suggestedAction || '').toLowerCase().includes(q)
          if (!matchName && !matchPhone && !matchAction) return false
        }

        // Filtro de Status
        if (statusFilter !== 'all' && item.status !== statusFilter) return false

        // Filtro de Etapa
        if (stageFilter !== 'all' && item.stageKey !== stageFilter) return false

        // Filtro de Unidade
        if (unidadeFilter !== 'all' && item.unidade !== unidadeFilter) return false

        return true
      })
      .sort((a, b) => {
        if (!a || !b) return 0
        // Itens não concluídos sempre acima dos concluídos
        if (a.completedToday !== b.completedToday) {
          return a.completedToday ? 1 : -1
        }

        if (sortField === 'priority') {
          return sortAsc
            ? (a.priorityScore || 0) - (b.priorityScore || 0)
            : (b.priorityScore || 0) - (a.priorityScore || 0)
        }
        if (sortField === 'name') {
          return sortAsc
            ? (a.name || '').localeCompare(b.name || '')
            : (b.name || '').localeCompare(a.name || '')
        }
        if (sortField === 'lastContact') {
          const tA = a.lastContactAt?.getTime() || 0
          const tB = b.lastContactAt?.getTime() || 0
          return sortAsc ? tA - tB : tB - tA
        }
        return 0
      })
  }, [
    queueItems,
    showOnlyPendingToday,
    searchTerm,
    statusFilter,
    stageFilter,
    unidadeFilter,
    sortField,
    sortAsc,
  ])

  // Contadores para os Cards de Resumo
  const counts = useMemo(() => {
    let precisa = 0
    let alerta = 0
    let negociacao = 0
    let aguardando = 0
    let concluidos = 0

    for (const item of queueItems) {
      if (item.completedToday) concluidos++
      if (item.status === 'PRECISA_DE_MENSAGEM') precisa++
      if (item.status === 'ALERTA') alerta++
      if (item.status === 'EM_NEGOCIACAO') negociacao++
      if (item.status === 'AGUARDANDO_RESPOSTA') aguardando++
    }

    return {
      total: queueItems.length,
      precisa,
      alerta,
      negociacao,
      aguardando,
      concluidos,
      pendentesHoje: queueItems.length - concluidos,
    }
  }, [queueItems])

  return (
    <div className="space-y-6 pb-12">
      {/* Top Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl sm:text-3xl font-serif font-bold text-primary tracking-tight">
              Fila do Dia
            </h1>
            <Badge
              variant="outline"
              className="bg-primary/5 text-primary border-primary/20 text-xs font-semibold"
            >
              Quem precisa de contato hoje
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
            <strong>Fila do Dia — quem precisa de contato hoje.</strong> Central unificada da
            secretária com confirmações, retornos e tarefas ordenados por prioridade clínica do dia.
          </p>
          {/* Status de Carga e Comparativo com Métricas Agregadas */}
          <div className="flex items-center gap-2 flex-wrap mt-2 text-xs">
            {lastLoadedAt && (
              <span className="inline-flex items-center gap-1 text-muted-foreground bg-muted/50 px-2 py-0.5 rounded-md">
                <Clock className="w-3 h-3 text-primary" />
                Última carga: <strong>{formatTimeSaoPaulo(lastLoadedAt)}</strong>
              </span>
            )}
            <span className="inline-flex items-center gap-1.5 text-muted-foreground bg-muted/50 px-2 py-0.5 rounded-md">
              <MessageSquare className="w-3 h-3 text-emerald-600" />
              Conversas não lidas: <strong>{metrics?.unread ?? 0}</strong>
              <span className="text-[10px] text-muted-foreground/80">
                (Fila: {queueItems.length} contatos)
              </span>
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Seletor Rápido: Fila Normal vs Plantão Fim de Semana */}
          <Button
            variant={abaFimDeSemanaAtiva ? 'default' : 'outline'}
            size="sm"
            onClick={() => setAbaFimDeSemanaAtiva(!abaFimDeSemanaAtiva)}
            className={cn(
              'h-9 gap-1.5 text-xs font-medium',
              abaFimDeSemanaAtiva
                ? 'bg-indigo-600 hover:bg-indigo-700 text-white'
                : 'border-indigo-200 text-indigo-700 hover:bg-indigo-50',
            )}
          >
            <Calendar className="w-3.5 h-3.5" />
            {abaFimDeSemanaAtiva ? 'Ver Fila Completa' : 'Fim de Semana (Plantão)'}
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={loadData}
            disabled={loading}
            className="h-9 gap-1.5 text-xs"
          >
            <RefreshCw className={cn('w-3.5 h-3.5', loading && 'animate-spin')} />
            Atualizar
          </Button>

          <Button
            size="sm"
            variant="outline"
            onClick={() => navigate('/revenda')}
            className="h-9 gap-1.5 text-xs border-primary/30 text-primary hover:bg-primary/5"
          >
            <Sparkles className="w-3.5 h-3.5 text-amber-500" />
            Painel de Revenda
          </Button>

          <Button
            size="sm"
            onClick={() => navigate('/conversas')}
            className="h-9 gap-1.5 text-xs bg-primary text-white"
          >
            <MessageSquare className="w-3.5 h-3.5" />
            Ir para Conversas
          </Button>
        </div>
      </div>

      {/* Banner / Card do Modo Plantão (fim de semana) */}
      <Card className="border-indigo-200/70 bg-gradient-to-r from-indigo-50/70 via-white to-purple-50/40 shadow-xs">
        <CardContent className="p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-100 text-indigo-700 flex items-center justify-center shrink-0">
              <Calendar className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-semibold text-sm text-foreground">
                  Modo Plantão (Fim de Semana)
                </span>
                <Badge
                  variant="outline"
                  className={cn(
                    'text-[10px] font-semibold',
                    plantaoFimDeSemana
                      ? 'bg-emerald-100 text-emerald-800 border-emerald-300'
                      : 'bg-slate-100 text-slate-700 border-slate-300',
                  )}
                >
                  {plantaoFimDeSemana ? 'IA ativa sáb/dom para dúvidas básicas' : 'Desligado'}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                {plantaoFimDeSemana
                  ? 'Nos fins de semana, a IA acolhe mensagens com a Memória da Clínica e gera pendências para a Fabiana revisar na segunda-feira.'
                  : 'Atendimento do fim de semana desativado. Mensagens aguardam o expediente padrão de segunda-feira.'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3 self-end sm:self-auto shrink-0">
            <div className="flex items-center space-x-2">
              <Switch
                id="plantao-switch-fila"
                checked={plantaoFimDeSemana}
                disabled={salvandoPlantao}
                onCheckedChange={handleTogglePlantao}
              />
              <Label
                htmlFor="plantao-switch-fila"
                className="text-xs font-semibold cursor-pointer select-none"
              >
                {plantaoFimDeSemana ? 'Plantão Ligado' : 'Plantão Desligado'}
              </Label>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Seção Fim de Semana (quando aba ativada): Pendências e Tarefas geradas no plantão */}
      {abaFimDeSemanaAtiva && (
        <Card className="border-indigo-300/80 bg-indigo-50/20">
          <CardHeader className="p-4 pb-2">
            <CardTitle className="text-sm font-semibold text-indigo-950 flex items-center gap-2">
              <Calendar className="w-4 h-4 text-indigo-600" />
              Pendências do Fim de Semana para Revisão na Segunda
            </CardTitle>
            <CardDescription className="text-xs text-indigo-900/80">
              Contatos e tarefas abertos durante o plantão que necessitam de acolhimento ou retorno
              humano no início da semana.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-4 pt-1 space-y-2">
            {tasksDegraded ? (
              <div className="p-3 rounded-xl bg-amber-50/60 border border-amber-200/80 flex items-center justify-between gap-3 text-xs">
                <span className="text-amber-800">
                  — Tarefas temporariamente indisponíveis (limite de requisições). Exibindo modo
                  degradado seguro.
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={loadData}
                  disabled={loading}
                  className="h-7 text-xs border-amber-300 text-amber-900 hover:bg-amber-100/50"
                >
                  <RefreshCw className={cn('w-3 h-3 mr-1', loading && 'animate-spin')} />
                  Tentar de novo
                </Button>
              </div>
            ) : tasks.filter(
                (t) =>
                  t.category === 'plantao' ||
                  t.title?.toLowerCase().includes('plantão') ||
                  t.description?.toLowerCase().includes('plantão') ||
                  t.description?.toLowerCase().includes('fim de semana'),
              ).length === 0 ? (
              <p className="text-xs text-muted-foreground py-2 italic">
                Nenhuma tarefa pendente marcada especificamente pelo Plantão no momento. Os
                atendimentos normais da fila abaixo já cobrem todos os pacientes com mensagens
                recentes.
              </p>
            ) : (
              <div className="space-y-2">
                {tasks
                  .filter(
                    (t) =>
                      t.category === 'plantao' ||
                      t.title?.toLowerCase().includes('plantão') ||
                      t.description?.toLowerCase().includes('plantão') ||
                      t.description?.toLowerCase().includes('fim de semana'),
                  )
                  .map((t) => (
                    <div
                      key={t.id}
                      className="p-3 rounded-xl bg-white border border-indigo-200/80 flex items-center justify-between gap-3 text-xs"
                    >
                      <div>
                        <span className="font-semibold text-foreground">{t.title}</span>
                        {t.description && (
                          <p className="text-muted-foreground text-[11px] mt-0.5">
                            {t.description}
                          </p>
                        )}
                      </div>
                      <Badge variant="outline" className="text-[10px] bg-indigo-50 text-indigo-700">
                        {t.status}
                      </Badge>
                    </div>
                  ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ═══ MENSAGENS RECEBIDAS SEM RESPOSTA POR FAIXA & SLA ═══ */}
      <Card className="border-border/50 bg-white/70 dark:bg-card/70 backdrop-blur-sm shadow-xs p-4 rounded-2xl">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 pb-3 border-b border-border/40">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-rose-100 text-rose-700 rounded-lg shrink-0">
              <Clock className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-serif font-bold text-sm sm:text-base text-primary">
                  Mensagens sem Resposta por Faixa de Espera
                </span>
                <Badge
                  variant="outline"
                  className="bg-rose-50 text-rose-800 border-rose-200 text-[10px] font-semibold"
                >
                  {metrics?.unansweredTiers?.total ?? 0} aguardando
                </Badge>
              </div>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Tempo decorrido desde a última mensagem recebida do paciente sem retorno posterior
                da clínica
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3 text-xs divide-x divide-border/60 bg-muted/40 px-3 py-1.5 rounded-xl border self-start md:self-auto">
            <div className="flex flex-col items-center pr-1">
              <span className="font-serif font-bold text-sm sm:text-base text-primary">
                {metrics?.firstResponseAvgMinutes?.days7 !== null &&
                metrics?.firstResponseAvgMinutes?.days7 !== undefined
                  ? `${metrics.firstResponseAvgMinutes.days7} min`
                  : '—'}
              </span>
              <span className="text-[10px] text-muted-foreground uppercase font-medium">
                1ª Resp. (7d)
              </span>
            </div>
            <div className="flex flex-col items-center pl-3">
              <span className="font-serif font-bold text-sm sm:text-base text-primary">
                {metrics?.firstResponseAvgMinutes?.days30 !== null &&
                metrics?.firstResponseAvgMinutes?.days30 !== undefined
                  ? `${metrics.firstResponseAvgMinutes.days30} min`
                  : '—'}
              </span>
              <span className="text-[10px] text-muted-foreground uppercase font-medium">
                1ª Resp. (30d)
              </span>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5 pt-3">
          <div className="p-2.5 rounded-xl border border-border/60 bg-emerald-50/40 flex flex-col justify-between">
            <div className="flex items-center justify-between text-[11px] font-semibold text-emerald-800">
              <span>Até 1h</span>
              <span className="text-[9px] bg-emerald-200/60 px-1 rounded-full">&lt;60m</span>
            </div>
            <span className="font-serif font-bold text-xl text-emerald-900 mt-1">
              {metrics?.unansweredTiers?.ate_1h ?? '—'}
            </span>
          </div>

          <div className="p-2.5 rounded-xl border border-border/60 bg-blue-50/40 flex flex-col justify-between">
            <div className="flex items-center justify-between text-[11px] font-semibold text-blue-800">
              <span>1h a 4h</span>
              <span className="text-[9px] bg-blue-200/60 px-1 rounded-full">60-240m</span>
            </div>
            <span className="font-serif font-bold text-xl text-blue-900 mt-1">
              {metrics?.unansweredTiers?.h1_a_4h ?? '—'}
            </span>
          </div>

          <div className="p-2.5 rounded-xl border border-border/60 bg-amber-50/40 flex flex-col justify-between">
            <div className="flex items-center justify-between text-[11px] font-semibold text-amber-800">
              <span>4h a 24h</span>
              <span className="text-[9px] bg-amber-200/60 px-1 rounded-full">Mesmo dia</span>
            </div>
            <span className="font-serif font-bold text-xl text-amber-900 mt-1">
              {metrics?.unansweredTiers?.h4_a_24h ?? '—'}
            </span>
          </div>

          <div className="p-2.5 rounded-xl border border-border/60 bg-orange-50/40 flex flex-col justify-between">
            <div className="flex items-center justify-between text-[11px] font-semibold text-orange-800">
              <span>24h a 48h</span>
              <span className="text-[9px] bg-orange-200/60 px-1 rounded-full">1-2 dias</span>
            </div>
            <span className="font-serif font-bold text-xl text-orange-900 mt-1">
              {metrics?.unansweredTiers?.h24_a_48h ?? '—'}
            </span>
          </div>

          <div className="p-2.5 rounded-xl border border-border/60 bg-rose-50/50 flex flex-col justify-between col-span-2 sm:col-span-1">
            <div className="flex items-center justify-between text-[11px] font-semibold text-rose-800">
              <span>&gt; 48h</span>
              <span className="text-[9px] bg-rose-200/60 px-1 rounded-full font-bold">Urgente</span>
            </div>
            <span className="font-serif font-bold text-xl text-rose-900 mt-1">
              {metrics?.unansweredTiers?.acima_48h ?? '—'}
            </span>
          </div>
        </div>
      </Card>

      {/* KPI Cards — Panorama do Dia */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Card
          onClick={() => {
            setStatusFilter(statusFilter === 'PRECISA_DE_MENSAGEM' ? 'all' : 'PRECISA_DE_MENSAGEM')
          }}
          className={cn(
            'border-border/50 cursor-pointer transition-all hover:border-emerald-400 bg-white/60 dark:bg-card',
            statusFilter === 'PRECISA_DE_MENSAGEM' &&
              'ring-2 ring-emerald-500 border-emerald-500 bg-emerald-50/20',
          )}
        >
          <CardContent className="p-3.5 flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0">
              <MessageSquare className="w-4 h-4" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground font-medium">Precisa de Mensagem</p>
              <p className="text-xl font-serif font-bold text-emerald-700">{counts.precisa}</p>
            </div>
          </CardContent>
        </Card>

        <Card
          onClick={() => {
            setStatusFilter(statusFilter === 'ALERTA' ? 'all' : 'ALERTA')
          }}
          className={cn(
            'border-border/50 cursor-pointer transition-all hover:border-rose-400 bg-white/60 dark:bg-card',
            statusFilter === 'ALERTA' && 'ring-2 ring-rose-500 border-rose-500 bg-rose-50/20',
          )}
        >
          <CardContent className="p-3.5 flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-rose-100 text-rose-700 flex items-center justify-center shrink-0">
              <AlertTriangle className="w-4 h-4" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground font-medium">Alertas / Urgentes</p>
              <p className="text-xl font-serif font-bold text-rose-700">{counts.alerta}</p>
            </div>
          </CardContent>
        </Card>

        <Card
          onClick={() => {
            setStatusFilter(statusFilter === 'EM_NEGOCIACAO' ? 'all' : 'EM_NEGOCIACAO')
          }}
          className={cn(
            'border-border/50 cursor-pointer transition-all hover:border-purple-400 bg-white/60 dark:bg-card',
            statusFilter === 'EM_NEGOCIACAO' &&
              'ring-2 ring-purple-500 border-purple-500 bg-purple-50/20',
          )}
        >
          <CardContent className="p-3.5 flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-purple-100 text-purple-700 flex items-center justify-center shrink-0">
              <Clock className="w-4 h-4" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground font-medium">Em Negociação</p>
              <p className="text-xl font-serif font-bold text-purple-700">{counts.negociacao}</p>
            </div>
          </CardContent>
        </Card>

        <Card
          onClick={() => {
            setStatusFilter(statusFilter === 'AGUARDANDO_RESPOSTA' ? 'all' : 'AGUARDANDO_RESPOSTA')
          }}
          className={cn(
            'border-border/50 cursor-pointer transition-all hover:border-amber-400 bg-white/60 dark:bg-card',
            statusFilter === 'AGUARDANDO_RESPOSTA' &&
              'ring-2 ring-amber-500 border-amber-500 bg-amber-50/20',
          )}
        >
          <CardContent className="p-3.5 flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-amber-100 text-amber-700 flex items-center justify-center shrink-0">
              <Clock className="w-4 h-4" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground font-medium">Aguardando Resposta</p>
              <p className="text-xl font-serif font-bold text-amber-700">{counts.aguardando}</p>
            </div>
          </CardContent>
        </Card>

        <Card
          onClick={() => setShowOnlyPendingToday(!showOnlyPendingToday)}
          className={cn(
            'border-border/50 cursor-pointer transition-all bg-white/60 dark:bg-card',
            !showOnlyPendingToday && 'ring-2 ring-primary border-primary bg-primary/5',
          )}
        >
          <CardContent className="p-3.5 flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0">
              <CheckCircle2 className="w-4 h-4" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground font-medium">Concluídos Hoje</p>
              <p className="text-xl font-serif font-bold text-primary">
                {counts.concluidos}{' '}
                <span className="text-xs font-normal text-muted-foreground">/ {counts.total}</span>
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Barra de Filtros e Busca */}
      <Card className="border-border/60 bg-card/60 backdrop-blur-sm">
        <CardContent className="p-4 space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-center">
            {/* Campo de Busca */}
            <div className="relative md:col-span-4">
              <Search className="w-4 h-4 absolute left-3 top-2.5 text-muted-foreground" />
              <Input
                placeholder="Buscar por nome, telefone com DDD ou ação..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-9 h-9 text-xs"
              />
            </div>

            {/* Filtro Status */}
            <div className="md:col-span-2">
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="h-9 text-xs">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos os Status</SelectItem>
                  <SelectItem value="PRECISA_DE_MENSAGEM">Precisa de Mensagem</SelectItem>
                  <SelectItem value="ALERTA">Alerta / Urgente</SelectItem>
                  <SelectItem value="EM_NEGOCIACAO">Em Negociação</SelectItem>
                  <SelectItem value="AGUARDANDO_RESPOSTA">Aguardando Resposta</SelectItem>
                  <SelectItem value="NAO_PRECISA">Não Precisa</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Filtro Etapa CRM */}
            <div className="md:col-span-2">
              <Select value={stageFilter} onValueChange={setStageFilter}>
                <SelectTrigger className="h-9 text-xs">
                  <SelectValue placeholder="Etapa CRM" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas as Etapas</SelectItem>
                  <SelectItem value="lead">Lead</SelectItem>
                  <SelectItem value="em_atendimento">Em atendimento</SelectItem>
                  <SelectItem value="orcamento_enviado">Orçamento Enviado</SelectItem>
                  <SelectItem value="cliente">Cliente</SelectItem>
                  <SelectItem value="perdido">Perdido</SelectItem>
                  <SelectItem value="nao_respondido">Não Respondidos</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Filtro Unidade */}
            <div className="md:col-span-2">
              <Select value={unidadeFilter} onValueChange={setUnidadeFilter}>
                <SelectTrigger className="h-9 text-xs">
                  <SelectValue placeholder="Unidade" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas as Unidades</SelectItem>
                  <SelectItem value="Carmo do Rio Claro">Carmo do Rio Claro</SelectItem>
                  <SelectItem value="Alfenas">Alfenas</SelectItem>
                  <SelectItem value="Monte Belo">Monte Belo</SelectItem>
                  <SelectItem value="Online">Online</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Ordenação */}
            <div className="md:col-span-2 flex items-center gap-1.5">
              <Select value={sortField} onValueChange={(val: any) => setSortField(val)}>
                <SelectTrigger className="h-9 text-xs flex-1">
                  <SelectValue placeholder="Ordenar" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="priority">Prioridade / Cuidado</SelectItem>
                  <SelectItem value="lastContact">Último Contato</SelectItem>
                  <SelectItem value="name">Nome (A-Z)</SelectItem>
                </SelectContent>
              </Select>

              <Button
                variant="outline"
                size="icon"
                onClick={() => setSortAsc(!sortAsc)}
                className="h-9 w-9 shrink-0 text-muted-foreground"
                title={sortAsc ? 'Ordem crescente' : 'Ordem decrescente'}
              >
                <ArrowUpDown className="w-3.5 h-3.5" />
              </Button>
            </div>
          </div>

          <div className="flex items-center justify-between pt-1 border-t border-border/40 text-xs text-muted-foreground">
            <div className="flex items-center gap-3">
              <span>
                Mostrando <strong>{filteredItems.length}</strong> de{' '}
                <strong>{queueItems.length}</strong> contatos
              </span>
              <button
                type="button"
                onClick={() => setShowOnlyPendingToday(!showOnlyPendingToday)}
                className="text-primary hover:underline font-medium text-xs flex items-center gap-1"
              >
                {showOnlyPendingToday ? (
                  <>
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                    Exibir também concluídos hoje ({counts.concluidos})
                  </>
                ) : (
                  <>
                    <RotateCcw className="w-3.5 h-3.5" />
                    Ocultar concluídos hoje
                  </>
                )}
              </button>
            </div>

            {(searchTerm ||
              statusFilter !== 'all' ||
              stageFilter !== 'all' ||
              unidadeFilter !== 'all') && (
              <button
                type="button"
                onClick={() => {
                  setSearchTerm('')
                  setStatusFilter('all')
                  setStageFilter('all')
                  setUnidadeFilter('all')
                }}
                className="text-rose-600 hover:underline"
              >
                Limpar filtros
              </button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Lista da Fila do Dia */}
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3, 4, 5].map((i) => (
            <Card key={i} className="border-border/50">
              <CardContent className="p-4 flex items-center gap-4">
                <Skeleton className="h-10 w-10 rounded-full" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-48" />
                  <Skeleton className="h-3 w-72" />
                </div>
                <Skeleton className="h-8 w-24" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : loadError && queueItems.length === 0 ? (
        <Card className="border-rose-200 bg-rose-50/40 p-8 text-center">
          <CardContent className="flex flex-col items-center justify-center p-0 space-y-3">
            <AlertTriangle className="w-10 h-10 text-rose-600" />
            <h3 className="font-serif font-bold text-base text-rose-900">
              Não foi possível carregar. Tentar de novo
            </h3>
            <p className="text-xs text-rose-700 max-w-md">
              {loadError || 'Houve uma falha ao conectar ao banco de dados.'}
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={loadData}
              className="h-8 text-xs mt-2 border-rose-300 text-rose-800 hover:bg-rose-100"
            >
              <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
              Tentar de novo
            </Button>
          </CardContent>
        </Card>
      ) : filteredItems.length === 0 ? (
        <Card className="border-dashed border-border/70 p-12 text-center">
          <CardContent className="flex flex-col items-center justify-center p-0 space-y-3">
            <CheckCircle2 className="w-12 h-12 text-emerald-600/60" />
            <h3 className="font-serif font-bold text-lg text-primary">Tudo em dia na Fila!</h3>
            <p className="text-xs text-muted-foreground max-w-md">
              {showOnlyPendingToday && counts.concluidos > 0
                ? `Todos os ${counts.concluidos} contatos prioritários de hoje foram concluídos. Parabéns, Fabiana!`
                : 'Nenhum contato encontrado com os filtros aplicados.'}
            </p>
            {showOnlyPendingToday && counts.concluidos > 0 && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowOnlyPendingToday(false)}
                className="h-8 text-xs mt-2"
              >
                Rever contatos concluídos hoje
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {filteredItems.map((item) => {
            const statusCfg = STATUS_CONFIG[item.status] || STATUS_CONFIG.NAO_PRECISA
            const isDone = item.completedToday

            return (
              <Card
                key={item.id}
                className={cn(
                  'border-border/50 transition-all hover:border-primary/40 hover:shadow-sm bg-card',
                  isDone && 'opacity-60 bg-muted/20 border-emerald-200/50',
                  item.status === 'ALERTA' && !isDone && 'border-rose-300/80 bg-rose-50/10',
                )}
              >
                <CardContent className="p-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
                  {/* Bloco 1: Identificação do Paciente e Contato */}
                  <div className="flex items-start gap-3 min-w-0 md:w-1/3">
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            onClick={() => toggleDoneToday(item.contactId, item.name)}
                            className={cn(
                              'mt-0.5 w-6 h-6 rounded-md border flex items-center justify-center transition-all shrink-0',
                              isDone
                                ? 'bg-emerald-600 border-emerald-600 text-white shadow-sm'
                                : 'border-border hover:border-primary text-transparent hover:text-muted-foreground',
                            )}
                            aria-label={
                              isDone ? 'Desmarcar concluído hoje' : 'Marcar concluído hoje'
                            }
                          >
                            <Check className="w-4 h-4 stroke-[3]" />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent side="top">
                          {isDone
                            ? 'Desmarcar conclusão de hoje'
                            : 'Marcar como concluído hoje por Fabiana'}
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Link
                          to={`/crm?contact=${item.contactId}`}
                          className={cn(
                            'font-semibold text-sm hover:underline hover:text-primary transition-colors truncate',
                            isDone && 'line-through text-muted-foreground',
                          )}
                        >
                          {item.name}
                        </Link>

                        {item.isPatient && (
                          <Badge
                            variant="outline"
                            className="text-[10px] py-0 bg-blue-50 text-blue-700 border-blue-200"
                          >
                            Paciente
                          </Badge>
                        )}

                        {item.isClubMember && (
                          <Badge
                            variant="outline"
                            className="text-[10px] py-0 bg-amber-50 text-amber-700 border-amber-200"
                          >
                            Clube
                          </Badge>
                        )}
                      </div>

                      <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5 flex-wrap">
                        <span className="font-mono flex items-center gap-1">
                          <Phone className="w-3 h-3 text-muted-foreground/70" />
                          {item.formattedPhone || item.phone || 'Sem telefone'}
                        </span>
                        <span>·</span>
                        <span className="flex items-center gap-1">
                          <Building2 className="w-3 h-3 text-muted-foreground/70" />
                          {item.unidade}
                        </span>
                        <span>·</span>
                        <span className="text-[11px] text-muted-foreground">
                          Conta: <strong>{item.instanceName}</strong>
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Bloco 2: Etapa CRM e Status Calculado */}
                  <div className="flex flex-col gap-1.5 md:w-1/4">
                    <div className="flex items-center gap-2">
                      <Badge
                        variant="outline"
                        className={cn(
                          'text-[10px] uppercase font-bold tracking-wider py-0.5 border',
                          statusCfg.badgeClass,
                        )}
                      >
                        <span
                          className={cn('w-1.5 h-1.5 rounded-full mr-1.5', statusCfg.dotClass)}
                        />
                        {statusCfg.label}
                      </Badge>

                      <Badge variant="secondary" className="text-[10px] py-0.5">
                        {item.stageLabel}
                      </Badge>
                    </div>

                    <div className="text-xs text-muted-foreground flex items-center gap-1.5">
                      <Clock className="w-3 h-3" />
                      <span>
                        Último contato:{' '}
                        {item.lastContactAt && !isNaN(item.lastContactAt.getTime()) ? (
                          <>
                            {formatBrazilianDate(item.lastContactAt)}{' '}
                            <span className="font-mono text-[11px]">
                              {formatTimeSaoPaulo(item.lastContactAt)}
                            </span>
                          </>
                        ) : (
                          'Sem registro'
                        )}
                      </span>
                    </div>
                  </div>

                  {/* Bloco 3: Próxima Ação Sugerida */}
                  <div className="flex-1 min-w-0 md:w-1/3">
                    <div className="p-2.5 rounded-lg bg-muted/40 border border-border/40 text-xs">
                      <div className="flex items-center gap-1 text-[11px] font-semibold text-primary mb-0.5">
                        <Sparkles className="w-3 h-3 text-amber-500" />
                        Próxima Ação Sugerida
                      </div>
                      <p className="text-muted-foreground line-clamp-2 leading-relaxed">
                        {item.suggestedAction}
                      </p>
                    </div>
                  </div>

                  {/* Bloco 4: Ações Rápidas */}
                  <div className="flex items-center gap-2 shrink-0 md:justify-end">
                    <Button
                      variant={isDone ? 'ghost' : 'outline'}
                      size="sm"
                      onClick={() => toggleDoneToday(item.contactId, item.name)}
                      className={cn(
                        'h-8 text-xs gap-1.5',
                        isDone
                          ? 'text-muted-foreground hover:text-foreground'
                          : 'text-emerald-700 hover:bg-emerald-50',
                      )}
                    >
                      <Check className="w-3.5 h-3.5" />
                      {isDone ? 'Reabrir' : 'Concluir'}
                    </Button>

                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => navigate(`/conversas?phone=${item.phone}`)}
                      className="h-8 text-xs gap-1.5"
                    >
                      <MessageSquare className="w-3.5 h-3.5 text-primary" />
                      Conversa
                    </Button>

                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => navigate(`/crm?contact=${item.contactId}`)}
                      className="h-8 w-8 p-0"
                      title="Ver ficha no CRM"
                    >
                      <ExternalLink className="w-3.5 h-3.5 text-muted-foreground" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {/* Rodapé Informativo — Salvaguardas e LGPD */}
      <div className="p-4 rounded-xl border border-border/40 bg-muted/20 text-xs text-muted-foreground flex flex-col sm:flex-row items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" />
          <span>
            <strong>LGPD Estrita e Segurança Clínica:</strong> Nenhum texto de conversa ou dado
            sensível é transferido externamente. A Fila do Dia é estritamente humana e de suporte à
            secretária.
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span>Dr. Caio &amp; Fabiana</span>
          <span>·</span>
          <span>v0.0.166 (Fase 3 Ativa)</span>
        </div>
      </div>
    </div>
  )
}
