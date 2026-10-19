import React, { useState, useEffect, useMemo, useCallback } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import {
  TrendingUp,
  Search,
  Filter,
  Sparkles,
  ArrowUpDown,
  Phone,
  Building2,
  Calendar,
  ExternalLink,
  MessageSquare,
  ShieldCheck,
  RefreshCw,
  Clock,
  CheckCircle2,
  AlertCircle,
  ChevronDown,
  Sliders,
  DollarSign,
  Award,
  Users,
  Repeat,
  HeartHandshake,
  UserCheck,
  Zap,
} from 'lucide-react'
import { toast } from 'sonner'
import pb from '@/lib/pocketbase/client'
import { safePbFullList } from '@/lib/pocketbase/resilient'
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { Progress } from '@/components/ui/progress'
import { useCurrentAccount } from '@/hooks/use-current-account'
import { useRealtime } from '@/hooks/use-realtime'
import { formatPhoneBR } from '@/lib/phone'
import { cn } from '@/lib/utils'
import type { CrmContact, Conversation, Task } from '@/types/models'
import { formatBrazilianDate, formatTimeSaoPaulo } from '@/lib/datetime'
import {
  calculateRevendaItem,
  REVENDA_DEFAULT_WEIGHTS,
  REVENDA_SEGMENTS,
  type RevendaContactItem,
  type RevendaSegmentKey,
  type RevendaScoreWeights,
} from '@/lib/revenda-score'

const SEGMENT_ICONS: Record<RevendaSegmentKey, React.ElementType> = {
  retomada: Repeat,
  fechamento: DollarSign,
  renovacao: Award,
  novo_servico: Sparkles,
  reativacao: HeartHandshake,
}

export default function Revenda() {
  const navigate = useNavigate()
  const { accountId } = useCurrentAccount()

  const [loading, setLoading] = useState(true)
  const [contacts, setContacts] = useState<CrmContact[]>([])
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [tasks, setTasks] = useState<Task[]>([])

  // Filtros e Ordenação
  const [searchTerm, setSearchTerm] = useState('')
  const [segmentFilter, setSegmentFilter] = useState<string>('all')
  const [minScoreFilter, setMinScoreFilter] = useState<number>(0)
  const [sortField, setSortField] = useState<'score' | 'recency' | 'budget' | 'name'>('score')
  const [sortAsc, setSortAsc] = useState(false)
  const [selectedContactDetail, setSelectedContactDetail] = useState<RevendaContactItem | null>(
    null,
  )

  // Configuração de Pesos (Permite ao Mentor/Dr. Caio inspecionar e simular)
  const [customWeights, setCustomWeights] = useState<RevendaScoreWeights>(REVENDA_DEFAULT_WEIGHTS)
  const [weightsDialogOpen, setWeightsDialogOpen] = useState(false)

  const safeWeights = customWeights || REVENDA_DEFAULT_WEIGHTS

  const loadData = useCallback(async () => {
    if (!accountId) {
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      // Consultas com safePbFullList (perPage=200, retry 429 respeitando retry-after e timeout)
      // Carregamento escalonado para não disparar rajada no backend
      const contactsRes = await safePbFullList<CrmContact>({
        collection: 'crm_contacts',
        filter: `account_id = "${accountId}" && archived != true`,
        sort: '-updated',
        perPage: 200,
        label: 'Revenda:contacts',
      }).catch(() => [] as CrmContact[])

      await new Promise((r) => setTimeout(r, 60))

      const convsRes = await safePbFullList<Conversation>({
        collection: 'conversations',
        filter: `account_id = "${accountId}" && archived != true`,
        sort: '-last_message_timestamp',
        perPage: 200,
        label: 'Revenda:conversations',
      }).catch(() => [] as Conversation[])

      await new Promise((r) => setTimeout(r, 60))

      const tasksRes = await safePbFullList<Task>({
        collection: 'tasks',
        filter: `account_id = "${accountId}" && status != "concluida" && status != "cancelada"`,
        sort: '-created',
        perPage: 200,
        label: 'Revenda:tasks',
      }).catch(() => [] as Task[])

      setContacts(Array.isArray(contactsRes) ? contactsRes : [])
      setConversations(Array.isArray(convsRes) ? convsRes : [])
      setTasks(Array.isArray(tasksRes) ? tasksRes : [])
    } catch (err) {
      console.warn('[Revenda] Erro inesperado ao carregar dados:', err)
      toast.error('Erro ao carregar os dados de Revenda')
    } finally {
      setLoading(false)
    }
  }, [accountId])

  useEffect(() => {
    loadData()
  }, [loadData])

  // Realtime updates
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

  // Processamento e Score de todos os contatos com blindagem total contra exceções
  const revendaItems: RevendaContactItem[] = useMemo(() => {
    if (!Array.isArray(contacts)) return []

    const validContacts = contacts.filter((c): c is CrmContact =>
      Boolean(c && typeof c === 'object' && c.id),
    )

    const items: RevendaContactItem[] = []
    for (const c of validContacts) {
      try {
        const rawJid = String(c.jid || '')
        const rawPhone = String(c.phone || '')
        const cleanPhone = (rawPhone || rawJid).replace(/\D/g, '')
        const conv =
          (rawJid ? convByJid.get(rawJid) : undefined) ||
          (cleanPhone ? convByJid.get(cleanPhone) : undefined)
        const contactTasks = (c.id ? tasksByContactId.get(c.id) : undefined) || []

        const calculated = calculateRevendaItem(c, conv, contactTasks, {
          weights: customWeights,
        })
        if (calculated && typeof calculated === 'object' && calculated.id) {
          items.push(calculated)
        }
      } catch (err) {
        console.warn('[Revenda] Erro ao calcular item de contato:', c.id, err)
      }
    }
    return items
  }, [contacts, convByJid, tasksByContactId, customWeights])

  // Contagens por Segmento para os KPIs blindadas contra segmentos inválidos ou nulos
  const segmentStats = useMemo(() => {
    const stats: Record<RevendaSegmentKey, { count: number; avgScore: number; sumScore: number }> =
      {
        retomada: { count: 0, avgScore: 0, sumScore: 0 },
        fechamento: { count: 0, avgScore: 0, sumScore: 0 },
        renovacao: { count: 0, avgScore: 0, sumScore: 0 },
        novo_servico: { count: 0, avgScore: 0, sumScore: 0 },
        reativacao: { count: 0, avgScore: 0, sumScore: 0 },
      }

    let hotLeads = 0 // Score >= 70
    let totalScoreSum = 0

    if (Array.isArray(revendaItems)) {
      for (const item of revendaItems) {
        if (!item) continue
        const itemScore =
          typeof item.score === 'number' && Number.isFinite(item.score) ? item.score : 0
        if (itemScore >= 70) hotLeads++
        totalScoreSum += itemScore

        const segKey = item.segment as RevendaSegmentKey
        const s = stats[segKey] || stats.retomada
        if (s) {
          s.count++
          s.sumScore += itemScore
        }
      }
    }

    const segments = Object.keys(stats) as RevendaSegmentKey[]
    for (const key of segments) {
      if (stats[key]?.count > 0) {
        stats[key].avgScore = Math.round(stats[key].sumScore / stats[key].count)
      }
    }

    return {
      total: revendaItems.length,
      hotLeads,
      averageScore: revendaItems.length > 0 ? Math.round(totalScoreSum / revendaItems.length) : 0,
      bySegment: stats,
    }
  }, [revendaItems])

  // Filtragem e Ordenação da Lista blindada contra valores nulos/indefinidos
  const filteredItems = useMemo(() => {
    if (!Array.isArray(revendaItems)) return []

    return revendaItems
      .filter((item) => {
        if (!item) return false
        const score = typeof item.score === 'number' && Number.isFinite(item.score) ? item.score : 0

        // Filtro de Score mínimo
        if (score < minScoreFilter) return false

        // Filtro de Segmento
        if (segmentFilter !== 'all' && item.segment !== segmentFilter) return false

        // Filtro de busca textual
        if (searchTerm.trim()) {
          const q = searchTerm.toLowerCase().trim()
          const cleanQ = q.replace(/\D/g, '')
          const nameStr = String(item.name || '').toLowerCase()
          const phoneStr = String(item.phone || '').toLowerCase()
          const actionStr = String(item.suggestedAction || '').toLowerCase()
          const triggerReasons = Array.isArray(item.breakdown?.triggerReasons)
            ? item.breakdown.triggerReasons
            : []

          const matchName = nameStr.includes(q)
          const matchPhone =
            phoneStr.includes(q) || (cleanQ.length >= 4 && phoneStr.includes(cleanQ))
          const matchAction = actionStr.includes(q)
          const matchReasons = triggerReasons.some((r) =>
            String(r || '')
              .toLowerCase()
              .includes(q),
          )
          if (!matchName && !matchPhone && !matchAction && !matchReasons) return false
        }

        return true
      })
      .sort((a, b) => {
        const scoreA = typeof a.score === 'number' && Number.isFinite(a.score) ? a.score : 0
        const scoreB = typeof b.score === 'number' && Number.isFinite(b.score) ? b.score : 0

        if (sortField === 'score') {
          return sortAsc ? scoreA - scoreB : scoreB - scoreA
        }
        if (sortField === 'recency') {
          const tA =
            a.lastContactAt instanceof Date && !isNaN(a.lastContactAt.getTime())
              ? a.lastContactAt.getTime()
              : 0
          const tB =
            b.lastContactAt instanceof Date && !isNaN(b.lastContactAt.getTime())
              ? b.lastContactAt.getTime()
              : 0
          return sortAsc ? tA - tB : tB - tA
        }
        if (sortField === 'budget') {
          const bA =
            typeof a.budgetValue === 'number' && Number.isFinite(a.budgetValue) ? a.budgetValue : 0
          const bB =
            typeof b.budgetValue === 'number' && Number.isFinite(b.budgetValue) ? b.budgetValue : 0
          return sortAsc ? bA - bB : bB - bA
        }
        if (sortField === 'name') {
          const nA = String(a.name || '')
          const nB = String(b.name || '')
          return sortAsc ? nA.localeCompare(nB) : nB.localeCompare(nA)
        }
        return 0
      })
  }, [revendaItems, minScoreFilter, segmentFilter, searchTerm, sortField, sortAsc])

  return (
    <div className="space-y-6 pb-14">
      {/* Top Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl sm:text-3xl font-serif font-bold text-primary tracking-tight flex items-center gap-2">
              <TrendingUp className="w-6 h-6 text-primary" />
              Revenda
            </h1>
            <Badge
              variant="outline"
              className="bg-primary/5 text-primary border-primary/20 text-xs font-semibold"
            >
              Priorize quem está mais perto de fechar
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground mt-1 max-w-3xl">
            <strong>Revenda — priorize quem está mais perto de fechar.</strong> Oportunidades
            ranqueadas por score (0 a 100) com base em recência, engajamento e histórico, sem
            disparos automáticos invasivos.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {/* Modal de Calibração de Pesos para o Mentor */}
          <Dialog open={weightsDialogOpen} onOpenChange={setWeightsDialogOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm" className="h-9 gap-1.5 text-xs">
                <Sliders className="w-3.5 h-3.5 text-muted-foreground" />
                Calibrar Pesos
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2 font-serif">
                  <Sliders className="w-5 h-5 text-primary" />
                  Pesos do Score de Revenda (Total: 100)
                </DialogTitle>
                <DialogDescription className="text-xs">
                  Especificação do contrato: os pesos são centralizados em{' '}
                  <code className="text-[11px] bg-muted px-1 py-0.5 rounded">
                    src/lib/revenda-score.ts
                  </code>
                  . O Mentor pode ajustar a distribuição de pontos conforme os testes de campo:
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4 py-2 text-xs">
                <div className="space-y-1.5">
                  <div className="flex justify-between">
                    <span className="font-semibold text-foreground">Recência (Último Contato)</span>
                    <span className="font-mono font-bold text-primary">
                      {safeWeights.recencia} pts
                    </span>
                  </div>
                  <Progress value={((safeWeights.recencia || 0) / 100) * 100} className="h-2" />
                  <p className="text-[11px] text-muted-foreground">
                    Baseado no intervalo em dias desde a última interação.
                  </p>
                </div>

                <div className="space-y-1.5">
                  <div className="flex justify-between">
                    <span className="font-semibold text-foreground">
                      Frequência (Histórico de Trocas)
                    </span>
                    <span className="font-mono font-bold text-primary">
                      {safeWeights.frequencia} pts
                    </span>
                  </div>
                  <Progress value={((safeWeights.frequencia || 0) / 100) * 100} className="h-2" />
                  <p className="text-[11px] text-muted-foreground">
                    Inbound, outbound, mensagens acumuladas e recall anterior.
                  </p>
                </div>

                <div className="space-y-1.5">
                  <div className="flex justify-between">
                    <span className="font-semibold text-foreground">
                      Engajamento (Atenção Ativa)
                    </span>
                    <span className="font-mono font-bold text-primary">
                      {safeWeights.engajamento} pts
                    </span>
                  </div>
                  <Progress value={((safeWeights.engajamento || 0) / 100) * 100} className="h-2" />
                  <p className="text-[11px] text-muted-foreground">
                    Unread do cliente aguardando, ai_priority e resposta rápida.
                  </p>
                </div>

                <div className="space-y-1.5">
                  <div className="flex justify-between">
                    <span className="font-semibold text-foreground">
                      Posição / Valor (Etapa e Clube)
                    </span>
                    <span className="font-mono font-bold text-primary">
                      {safeWeights.posicaoValor} pts
                    </span>
                  </div>
                  <Progress value={((safeWeights.posicaoValor || 0) / 100) * 100} className="h-2" />
                  <p className="text-[11px] text-muted-foreground">
                    Etapa no funil (orçamento enviado), valor de proposta e membro do clube.
                  </p>
                </div>

                <div className="space-y-1.5">
                  <div className="flex justify-between">
                    <span className="font-semibold text-foreground">
                      Gatilhos Clínicos (Regras Temporais)
                    </span>
                    <span className="font-mono font-bold text-primary">
                      {safeWeights.gatilhos} pts
                    </span>
                  </div>
                  <Progress value={((safeWeights.gatilhos || 0) / 100) * 100} className="h-2" />
                  <p className="text-[11px] text-muted-foreground">
                    Orçamento 7d sem resposta, clube vencendo em 15d, retorno de rotina 30-45d.
                  </p>
                </div>

                <div className="p-3 bg-muted/40 rounded-lg border text-muted-foreground text-[11px] space-y-1">
                  <p className="font-semibold text-foreground">
                    Como o Mentor ajusta permanentemente?
                  </p>
                  <p>
                    Edite a constante <code className="font-mono">REVENDA_DEFAULT_WEIGHTS</code> em{' '}
                    <code className="font-mono">src/lib/revenda-score.ts</code>. Toda a interface e
                    os cálculos adotam os novos pesos instantaneamente.
                  </p>
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCustomWeights(REVENDA_DEFAULT_WEIGHTS)}
                  className="text-xs"
                >
                  Restaurar Padrão
                </Button>
                <Button
                  size="sm"
                  onClick={() => setWeightsDialogOpen(false)}
                  className="text-xs bg-primary text-white"
                >
                  Fechar
                </Button>
              </div>
            </DialogContent>
          </Dialog>

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
            onClick={() => navigate('/fila')}
            className="h-9 gap-1.5 text-xs bg-primary text-white"
          >
            <Clock className="w-3.5 h-3.5" />
            Fila do Dia
          </Button>
        </div>
      </div>

      {/* Panorama dos 5 Segmentos de Revenda (KPIs Interativos) */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {(Object.keys(REVENDA_SEGMENTS) as RevendaSegmentKey[]).map((segKey) => {
          const seg = REVENDA_SEGMENTS[segKey] || REVENDA_SEGMENTS.retomada
          const stats = segmentStats?.bySegment?.[segKey] || { count: 0, avgScore: 0, sumScore: 0 }
          const Icon = SEGMENT_ICONS[segKey] || Repeat
          const isSelected = segmentFilter === segKey

          return (
            <Card
              key={segKey}
              onClick={() => setSegmentFilter(isSelected ? 'all' : segKey)}
              className={cn(
                'border-border/50 cursor-pointer transition-all hover:shadow-sm bg-white/70 dark:bg-card hover:border-primary/40',
                isSelected && 'ring-2 ring-primary border-primary bg-primary/5',
              )}
            >
              <CardContent className="p-3.5 space-y-2">
                <div className="flex items-center justify-between">
                  <div
                    className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                    style={{
                      backgroundColor: `${seg?.accentColor || '#2563eb'}18`,
                      color: seg?.accentColor || '#2563eb',
                    }}
                  >
                    <Icon className="w-4 h-4" />
                  </div>
                  <Badge variant="outline" className={cn('text-[10px] py-0', seg?.badgeClass)}>
                    Score médio {stats?.avgScore ?? 0}
                  </Badge>
                </div>

                <div>
                  <h3 className="text-xs font-semibold text-foreground truncate">
                    {seg?.label || segKey}
                  </h3>
                  <div className="flex items-baseline gap-1.5 mt-0.5">
                    <span className="text-xl font-serif font-bold text-primary">
                      {stats?.count ?? 0}
                    </span>
                    <span className="text-[11px] text-muted-foreground">contatos</span>
                  </div>
                </div>

                <p className="text-[10px] text-muted-foreground line-clamp-1 leading-snug">
                  {seg?.description || ''}
                </p>
              </CardContent>
            </Card>
          )
        })}
      </div>

      {/* Barra de Filtros, Busca e Segmentos */}
      <Card className="border-border/60 bg-card/60 backdrop-blur-sm">
        <CardContent className="p-4 space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-center">
            {/* Busca Textual */}
            <div className="relative md:col-span-4">
              <Search className="w-4 h-4 absolute left-3 top-2.5 text-muted-foreground" />
              <Input
                placeholder="Buscar por paciente, telefone, motivo de revenda..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-9 h-9 text-xs"
              />
            </div>

            {/* Filtro de Segmento */}
            <div className="md:col-span-3">
              <Select value={segmentFilter} onValueChange={setSegmentFilter}>
                <SelectTrigger className="h-9 text-xs">
                  <SelectValue placeholder="Segmento de Revenda" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos os Segmentos ({revendaItems.length})</SelectItem>
                  <SelectItem value="retomada">
                    Retomada ({segmentStats?.bySegment?.retomada?.count ?? 0})
                  </SelectItem>
                  <SelectItem value="fechamento">
                    Fechamento ({segmentStats?.bySegment?.fechamento?.count ?? 0})
                  </SelectItem>
                  <SelectItem value="renovacao">
                    Renovação ({segmentStats?.bySegment?.renovacao?.count ?? 0})
                  </SelectItem>
                  <SelectItem value="novo_servico">
                    Novo Serviço ({segmentStats?.bySegment?.novo_servico?.count ?? 0})
                  </SelectItem>
                  <SelectItem value="reativacao">
                    Reativação ({segmentStats?.bySegment?.reativacao?.count ?? 0})
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Filtro de Faixa de Score */}
            <div className="md:col-span-2">
              <Select
                value={String(minScoreFilter)}
                onValueChange={(val) => setMinScoreFilter(Number(val))}
              >
                <SelectTrigger className="h-9 text-xs">
                  <SelectValue placeholder="Score Mínimo" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="0">Qualquer Score (0–100)</SelectItem>
                  <SelectItem value="40">Score &gt;= 40 (Relevante)</SelectItem>
                  <SelectItem value="60">Score &gt;= 60 (Alta Prioridade)</SelectItem>
                  <SelectItem value="75">Score &gt;= 75 (Muito Quente)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Ordenação */}
            <div className="md:col-span-3 flex items-center gap-1.5">
              <Select value={sortField} onValueChange={(val: any) => setSortField(val)}>
                <SelectTrigger className="h-9 text-xs flex-1">
                  <SelectValue placeholder="Ordenar" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="score">Score de Interesse (0–100)</SelectItem>
                  <SelectItem value="recency">Último Contato</SelectItem>
                  <SelectItem value="budget">Valor da Proposta / Orçamento</SelectItem>
                  <SelectItem value="name">Nome do Contato</SelectItem>
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
                Exibindo <strong>{filteredItems.length}</strong> de{' '}
                <strong>{revendaItems.length}</strong> oportunidades
              </span>
              <span>·</span>
              <span className="flex items-center gap-1 text-emerald-700 font-medium">
                <Zap className="w-3.5 h-3.5 text-amber-500 fill-amber-500" />
                {segmentStats?.hotLeads ?? 0} contatos quentes (Score &gt;= 70)
              </span>
            </div>

            {(searchTerm || segmentFilter !== 'all' || minScoreFilter > 0) && (
              <button
                type="button"
                onClick={() => {
                  setSearchTerm('')
                  setSegmentFilter('all')
                  setMinScoreFilter(0)
                }}
                className="text-rose-600 hover:underline"
              >
                Limpar filtros
              </button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Lista de Oportunidades de Revenda Ordenada por Score */}
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3, 4, 5].map((i) => (
            <Card key={i} className="border-border/50">
              <CardContent className="p-4 flex items-center gap-4">
                <Skeleton className="h-10 w-10 rounded-lg" />
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
            <TrendingUp className="w-12 h-12 text-muted-foreground/40" />
            <h3 className="font-serif font-bold text-lg text-primary">
              Nenhuma oportunidade encontrada
            </h3>
            <p className="text-xs text-muted-foreground max-w-md">
              Nenhum contato atingiu os critérios de filtro atuais. Tente reduzir o score mínimo ou
              selecionar todos os segmentos.
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setSearchTerm('')
                setSegmentFilter('all')
                setMinScoreFilter(0)
              }}
              className="h-8 text-xs mt-2"
            >
              Ver todos os contatos
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2.5">
          {filteredItems.map((item) => {
            const safeSegmentKey =
              item?.segment && REVENDA_SEGMENTS[item.segment] ? item.segment : 'retomada'
            const seg =
              item?.segmentMeta || REVENDA_SEGMENTS[safeSegmentKey] || REVENDA_SEGMENTS.retomada
            const Icon = SEGMENT_ICONS[safeSegmentKey] || SEGMENT_ICONS.retomada
            const scoreVal =
              typeof item?.score === 'number' && Number.isFinite(item.score) ? item.score : 0
            const scoreColor =
              scoreVal >= 75
                ? 'text-emerald-700 bg-emerald-50 border-emerald-200'
                : scoreVal >= 50
                  ? 'text-purple-700 bg-purple-50 border-purple-200'
                  : scoreVal >= 30
                    ? 'text-amber-700 bg-amber-50 border-amber-200'
                    : 'text-slate-600 bg-slate-50 border-slate-200'

            const appliedWeights =
              item?.breakdown?.appliedWeights || customWeights || REVENDA_DEFAULT_WEIGHTS
            const triggerReasons = Array.isArray(item?.breakdown?.triggerReasons)
              ? item.breakdown.triggerReasons
              : []
            const budgetVal =
              typeof item?.budgetValue === 'number' && Number.isFinite(item.budgetValue)
                ? item.budgetValue
                : 0
            const cleanPhone = String(item?.phone || '').replace(/\D/g, '')
            return (
              <Card
                key={item.id}
                className={cn(
                  'border-border/50 transition-all hover:border-primary/40 hover:shadow-sm bg-card',
                  scoreVal >= 75 && 'border-emerald-300/60 bg-emerald-50/5',
                )}
              >
                <CardContent className="p-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
                  {/* Bloco 1: Score 0-100 & Segmento */}
                  <div className="flex items-center gap-3.5 min-w-0 md:w-1/4">
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <div
                            className={cn(
                              'w-12 h-12 rounded-xl border flex flex-col items-center justify-center shrink-0 font-mono shadow-xs',
                              scoreColor,
                            )}
                          >
                            <span className="text-lg font-bold leading-none">{scoreVal}</span>
                            <span className="text-[9px] font-sans font-medium uppercase tracking-tight text-muted-foreground">
                              pts
                            </span>
                          </div>
                        </TooltipTrigger>
                        <TooltipContent side="top" className="text-xs p-3 space-y-1.5 max-w-xs">
                          <p className="font-bold text-foreground">Breakdown do Score (0–100):</p>
                          <div className="space-y-1 text-[11px]">
                            <div className="flex justify-between">
                              <span>Recência (max {appliedWeights.recencia}):</span>
                              <span className="font-mono font-bold">
                                {item.breakdown?.recencia ?? 0} pts
                              </span>
                            </div>
                            <div className="flex justify-between">
                              <span>Frequência (max {appliedWeights.frequencia}):</span>
                              <span className="font-mono font-bold">
                                {item.breakdown?.frequencia ?? 0} pts
                              </span>
                            </div>
                            <div className="flex justify-between">
                              <span>Engajamento (max {appliedWeights.engajamento}):</span>
                              <span className="font-mono font-bold">
                                {item.breakdown?.engajamento ?? 0} pts
                              </span>
                            </div>
                            <div className="flex justify-between">
                              <span>Posição/Valor (max {appliedWeights.posicaoValor}):</span>
                              <span className="font-mono font-bold">
                                {item.breakdown?.posicaoValor ?? 0} pts
                              </span>
                            </div>
                            <div className="flex justify-between">
                              <span>Gatilhos (max {appliedWeights.gatilhos}):</span>
                              <span className="font-mono font-bold">
                                {item.breakdown?.gatilhos ?? 0} pts
                              </span>
                            </div>
                          </div>
                          {triggerReasons.length > 0 && (
                            <p className="text-[10px] text-amber-600 pt-1 border-t">
                              Gatilho: {triggerReasons.join(', ')}
                            </p>
                          )}
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <Badge
                          variant="outline"
                          className={cn('text-[10px] font-semibold py-0.5 border', seg?.badgeClass)}
                        >
                          <Icon className="w-3 h-3 mr-1" />
                          {seg?.label || 'Revenda'}
                        </Badge>

                        {item.isClubMember && (
                          <Badge
                            variant="outline"
                            className="text-[9px] py-0 bg-amber-50 text-amber-800 border-amber-300"
                          >
                            Clube
                          </Badge>
                        )}

                        {budgetVal > 0 && (
                          <Badge
                            variant="secondary"
                            className="text-[9px] py-0 font-mono text-purple-700 bg-purple-50"
                          >
                            R$ {budgetVal.toLocaleString('pt-BR')}
                          </Badge>
                        )}
                      </div>

                      <div className="text-[11px] text-muted-foreground mt-1 flex items-center gap-1">
                        <Clock className="w-3 h-3 text-muted-foreground/70" />
                        <span>
                          {item.daysSinceLastContact === 0
                            ? 'Contato hoje'
                            : item.daysSinceLastContact === 999
                              ? 'Sem contato recente'
                              : `Último contato há ${item.daysSinceLastContact}d`}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Bloco 2: Identificação do Paciente / Contato */}
                  <div className="flex flex-col min-w-0 md:w-1/4">
                    <div className="flex items-center gap-1.5">
                      {item.contactId ? (
                        <Link
                          to={`/crm?contact=${item.contactId}`}
                          className="font-semibold text-sm hover:underline hover:text-primary transition-colors truncate"
                        >
                          {item.name || 'Contato sem nome'}
                        </Link>
                      ) : (
                        <span className="font-semibold text-sm truncate">
                          {item.name || 'Contato sem nome'}
                        </span>
                      )}
                      {item.isPatient && (
                        <Badge
                          variant="outline"
                          className="text-[9px] py-0 bg-blue-50 text-blue-700 border-blue-200 shrink-0"
                        >
                          Paciente
                        </Badge>
                      )}
                    </div>

                    <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
                      <span className="font-mono flex items-center gap-1">
                        <Phone className="w-3 h-3 text-muted-foreground/70" />
                        {formatPhoneBR(item.phone) || 'Sem telefone'}
                      </span>
                    </div>

                    {triggerReasons.length > 0 && (
                      <div className="flex items-center gap-1 text-[11px] text-amber-700 dark:text-amber-400 mt-1">
                        <Zap className="w-3 h-3 shrink-0" />
                        <span className="truncate">{triggerReasons[0]}</span>
                      </div>
                    )}
                  </div>

                  {/* Bloco 3: Breakdown Visual e Sugestão de Abordagem */}
                  <div className="flex-1 min-w-0 md:w-1/3">
                    <div className="p-2.5 rounded-lg bg-muted/40 border border-border/40 text-xs space-y-1.5">
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="font-semibold text-primary flex items-center gap-1">
                          <Sparkles className="w-3 h-3 text-amber-500" />
                          Abordagem Sugerida:
                        </span>
                        <span className="text-[10px] text-muted-foreground">
                          R:{item.breakdown?.recencia ?? 0} · F:{item.breakdown?.frequencia ?? 0} ·
                          E:
                          {item.breakdown?.engajamento ?? 0} · P:{item.breakdown?.posicaoValor ?? 0}{' '}
                          · G:
                          {item.breakdown?.gatilhos ?? 0}
                        </span>
                      </div>
                      <p className="text-muted-foreground line-clamp-2 leading-relaxed text-[11px]">
                        {item.suggestedAction || 'Propor contato acolhedor.'}
                      </p>
                    </div>
                  </div>

                  {/* Bloco 4: Ações Rápidas (Humanas, sem automações) */}
                  <div className="flex items-center gap-2 shrink-0 md:justify-end">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        const targetPhone = cleanPhone || item.phone
                        navigate(targetPhone ? `/conversas?phone=${targetPhone}` : '/conversas')
                      }}
                      className="h-8 text-xs gap-1.5"
                    >
                      <MessageSquare className="w-3.5 h-3.5 text-primary" />
                      Conversar
                    </Button>

                    {item.contactId && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => navigate(`/crm?contact=${item.contactId}`)}
                        className="h-8 w-8 p-0"
                        title="Abrir ficha no CRM"
                      >
                        <ExternalLink className="w-3.5 h-3.5 text-muted-foreground" />
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {/* Rodapé Informativo do Contrato e Salvaguardas */}
      <div className="p-4 rounded-xl border border-border/40 bg-muted/20 text-xs text-muted-foreground flex flex-col sm:flex-row items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" />
          <span>
            <strong>LGPD Estrita e Governança Clínica:</strong> Todos os scores utilizam apenas
            metadados consolidados (recência, frequência e valores contratuais). Nenhuma automação
            dispara mensagens sem autorização explícita da Fabiana ou do Dr. Caio.
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span>Fase 4 Aprovada</span>
          <span>·</span>
          <span>CRM Dr. Caio</span>
        </div>
      </div>
    </div>
  )
}
