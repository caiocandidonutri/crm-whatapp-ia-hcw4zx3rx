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
  const { accountId } = useCurrentAccount()

  const [loading, setLoading] = useState(true)
  const [contacts, setContacts] = useState<CrmContact[]>([])
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [tasks, setTasks] = useState<Task[]>([])
  const [doneTodayIds, setDoneTodayIds] = useState<Set<string>>(() => loadDoneSet(accountId))

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

  const loadData = useCallback(async () => {
    if (!accountId) {
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const [contactsRes, convsRes, tasksRes] = await Promise.all([
        pb
          .collection('crm_contacts')
          .getFullList<CrmContact>({
            filter: `account_id = "${accountId}" && archived != true`,
            sort: '-updated',
            requestKey: null,
          })
          .catch(() => [] as CrmContact[]),
        pb
          .collection('conversations')
          .getFullList<Conversation>({
            filter: `account_id = "${accountId}" && archived != true`,
            sort: '-last_message_timestamp',
            requestKey: null,
          })
          .catch(() => [] as Conversation[]),
        pb
          .collection('tasks')
          .getFullList<Task>({
            filter: `account_id = "${accountId}" && status != "concluida" && status != "cancelada"`,
            sort: '-created',
            requestKey: null,
          })
          .catch(() => [] as Task[]),
      ])

      setContacts(contactsRes || [])
      setConversations(convsRes || [])
      setTasks(tasksRes || [])
    } catch (err) {
      console.warn('[FilaDoDia] Erro ao carregar dados:', err)
      toast.error('Erro ao carregar a Fila do Dia')
    } finally {
      setLoading(false)
    }
  }, [accountId])

  useEffect(() => {
    loadData()
  }, [loadData])

  // Assinaturas realtime com kill-safety
  useRealtime('crm_contacts', () => loadData(), !!accountId)
  useRealtime('conversations', () => loadData(), !!accountId)
  useRealtime('tasks', () => loadData(), !!accountId)

  // Mapas auxiliares para busca O(1)
  const convByJid = useMemo(() => {
    const map = new Map<string, Conversation>()
    for (const c of conversations) {
      if (c.remote_jid) map.set(c.remote_jid, c)
      if (c.contact_phone) {
        const clean = c.contact_phone.replace(/\D/g, '')
        if (clean) map.set(clean, c)
      }
    }
    return map
  }, [conversations])

  const tasksByContactId = useMemo(() => {
    const map = new Map<string, Task[]>()
    for (const t of tasks) {
      if (t.crm_contact_id) {
        if (!map.has(t.crm_contact_id)) map.set(t.crm_contact_id, [])
        map.get(t.crm_contact_id)!.push(t)
      }
    }
    return map
  }, [tasks])

  // Derivação estrita da fila a partir dos dados existentes com blindagem total contra nulos
  const queueItems: FilaItem[] = useMemo(() => {
    const now = Date.now()

    if (!Array.isArray(contacts)) return []

    return contacts
      .filter((c): c is CrmContact => Boolean(c && typeof c === 'object' && c.id))
      .map((c) => {
        const rawJid = String(c.jid || '')
        const rawPhone = String(c.phone || '')
        const cleanPhone = (rawPhone || rawJid).replace(/\D/g, '')
        const conv =
          (rawJid ? convByJid.get(rawJid) : undefined) ||
          (cleanPhone ? convByJid.get(cleanPhone) : undefined)
        const contactTasks = (c.id ? tasksByContactId.get(c.id) : undefined) || []
        const hasOpenTask = contactTasks.length > 0
        const openTaskTitle = contactTasks[0]?.title || ''

        // Identificação da última mensagem / contato
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

        // Cálculo de Status da Fila
        let status: FilaStatus = 'NAO_PRECISA'
        let suggestedAction =
          String(c.ai_suggested_action || '').trim() ||
          'Manter contato ativo conforme necessidade clínica.'

        const stageKey = String(c.stage || 'lead')
          .trim()
          .toLowerCase()
        const hoursSinceLastContact =
          lastContactAt && !isNaN(lastContactAt.getTime())
            ? (now - lastContactAt.getTime()) / 3600000
            : 9999
        const daysSinceLastContact = hoursSinceLastContact / 24

        // Lógica de Priorização e Status
        if (
          c.care_status === 'precisa_atencao' ||
          c.care_status === 'alta_demanda' ||
          (hasOpenTask && contactTasks.some((t) => t?.priority === 'urgente'))
        ) {
          status = 'ALERTA'
          suggestedAction =
            openTaskTitle ||
            c.ai_suggested_action ||
            'Paciente em alerta de cuidado — verificar histórico e acolher.'
        } else if (stageKey === 'orcamento_enviado') {
          status = 'EM_NEGOCIACAO'
          suggestedAction =
            c.ai_suggested_action ||
            (daysSinceLastContact >= 3
              ? 'Proposta em aberto há mais de 3 dias — fazer follow-up acolhedor via WhatsApp.'
              : 'Acompanhar decisão do orçamento enviado.')
        } else if (hasUnreadFromClient || c.care_status === 'precisa_retorno') {
          status = 'PRECISA_DE_MENSAGEM'
          suggestedAction = hasUnreadFromClient
            ? 'Mensagem nova não respondida — responder e dar andamento ao atendimento.'
            : 'Paciente precisa de retorno (agendamento ou dúvidas clínicas).'
        } else if (c.care_status === 'nao_respondeu' || stageKey === 'nao_respondido') {
          if (daysSinceLastContact >= 5) {
            status = 'PRECISA_DE_MENSAGEM'
            suggestedAction =
              'Paciente não respondeu aos últimos contatos — enviar tentativa suave de reengajamento.'
          } else {
            status = 'AGUARDANDO_RESPOSTA'
            suggestedAction = 'Aguardando paciente visualizar e responder mensagem recente.'
          }
        } else if (stageKey === 'em_atendimento' || stageKey === 'lead') {
          if (hoursSinceLastContact >= 12) {
            status = 'PRECISA_DE_MENSAGEM'
            suggestedAction =
              'Lead/Atendimento em aberto sem interação há mais de 12h — avançar próximo passo.'
          } else {
            status = 'AGUARDANDO_RESPOSTA'
            suggestedAction = 'Em atendimento ativo hoje — acompanhar troca de mensagens.'
          }
        } else if (stageKey === 'cliente') {
          // Verificar se plano está expirando
          if (c.plan_expires_at) {
            const expDate = parseToDate(c.plan_expires_at)
            if (expDate && !isNaN(expDate.getTime())) {
              const daysUntilExp = (expDate.getTime() - now) / 86400000
              if (daysUntilExp <= 20 && daysUntilExp >= -5) {
                status = 'EM_NEGOCIACAO'
                suggestedAction = `Plano/clube vence em ${Math.max(0, Math.round(daysUntilExp))} dias — propor renovação.`
              }
            }
          }
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

        const isCompletedToday = doneTodayIds.has(c.id)

        // Identificação da Unidade
        const notesStr = String(c.notes || '').toLowerCase()
        let unidade = 'Carmo do Rio Claro'
        if (notesStr.includes('alfenas')) unidade = 'Alfenas'
        else if (notesStr.includes('monte belo')) unidade = 'Monte Belo'
        else if (notesStr.includes('online')) unidade = 'Online'

        const displayName =
          c.contact_name?.trim() ||
          c.push_name?.trim() ||
          (rawPhone ? formatPhoneBR(rawPhone) : 'Sem Nome')
        const formattedPhone = formatPhoneBR(rawPhone || rawJid)

        const cfg = STATUS_CONFIG[status] || STATUS_CONFIG.NAO_PRECISA

        return {
          id: c.id,
          contactId: c.id,
          name: displayName,
          phone: rawPhone || rawJid,
          formattedPhone,
          instanceName: c.instance_name || 'Principal',
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
          budget: typeof c.budget_value === 'number' ? c.budget_value : Number(c.budget_value) || 0,
          isPatient: Boolean(c.is_patient),
          isClubMember: Boolean(c.is_club_member),
          planExpiresAt: c.plan_expires_at,
          hasOpenTask,
          taskTitle: openTaskTitle,
        }
      })
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

  // Filtragem e Ordenação
  const filteredItems = useMemo(() => {
    return queueItems
      .filter((item) => {
        // Filtro de concluídos hoje
        if (showOnlyPendingToday && item.completedToday) return false

        // Filtro de texto
        if (searchTerm.trim()) {
          const q = searchTerm.toLowerCase().trim()
          const cleanQ = q.replace(/\D/g, '')
          const matchName = item.name.toLowerCase().includes(q)
          const matchPhone =
            item.phone.toLowerCase().includes(q) ||
            (cleanQ.length >= 4 && item.phone.includes(cleanQ))
          const matchAction = item.suggestedAction.toLowerCase().includes(q)
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
        // Itens não concluídos sempre acima dos concluídos
        if (a.completedToday !== b.completedToday) {
          return a.completedToday ? 1 : -1
        }

        if (sortField === 'priority') {
          return sortAsc ? a.priorityScore - b.priorityScore : b.priorityScore - a.priorityScore
        }
        if (sortField === 'name') {
          return sortAsc ? a.name.localeCompare(b.name) : b.name.localeCompare(a.name)
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
        </div>

        <div className="flex items-center gap-2">
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
                        {item.lastContactAt ? (
                          <>
                            {formatBrazilianDate(item.lastContactAt.toISOString())}{' '}
                            <span className="font-mono text-[11px]">
                              {formatTimeSaoPaulo(item.lastContactAt.toISOString())}
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
