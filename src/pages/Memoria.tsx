import { useState, useEffect, useCallback, useMemo } from 'react'
import { useAuth } from '@/hooks/use-auth'
import {
  listKnowledgeBase,
  createKnowledgeBaseEntry,
  updateKnowledgeBaseEntry,
  approveKnowledgeBaseEntry,
  archiveKnowledgeBaseEntry,
  deleteKnowledgeBaseEntry,
} from '@/services/knowledge_base_service'
import type { KnowledgeBaseEntry, KnowledgeBaseCategory, KnowledgeBaseStatus } from '@/types/models'
import { Card, CardHeader, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Brain,
  Sparkles,
  User,
  ShieldCheck,
  Lock,
  Plus,
  RefreshCw,
  Search,
  Check,
  Pencil,
  Archive,
  Trash2,
  HelpCircle,
  BookOpen,
  DollarSign,
  Clock,
  Pill,
  FileText,
  BookmarkCheck,
  AlertCircle,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useToast } from '@/hooks/use-toast'

export const CATEGORIAS_KNOWLEDGE_BASE: Record<
  KnowledgeBaseCategory,
  { label: string; icon: any; corBadge: string }
> = {
  precos: {
    label: 'Preços & Valores',
    icon: DollarSign,
    corBadge: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  },
  unidades_horarios: {
    label: 'Unidades & Horários',
    icon: Clock,
    corBadge: 'bg-blue-100 text-blue-800 border-blue-200',
  },
  suplementos: {
    label: 'Suplementos & Fórmulas',
    icon: Pill,
    corBadge: 'bg-amber-100 text-amber-800 border-amber-200',
  },
  orientacoes: {
    label: 'Orientações ao Paciente',
    icon: FileText,
    corBadge: 'bg-teal-100 text-teal-800 border-teal-200',
  },
  protocolos: {
    label: 'Protocolos & Retornos',
    icon: BookmarkCheck,
    corBadge: 'bg-purple-100 text-purple-800 border-purple-200',
  },
  geral: {
    label: 'Geral & Consultório',
    icon: BookOpen,
    corBadge: 'bg-slate-100 text-slate-800 border-slate-200',
  },
}

export function Memoria() {
  const { user } = useAuth()
  const { toast } = useToast()
  const accountId = user?.account_id

  const [itens, setItens] = useState<KnowledgeBaseEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [busca, setBusca] = useState('')
  const [categoriaFiltro, setCategoriaFiltro] = useState<KnowledgeBaseCategory | 'todas'>('todas')
  const [statusFiltro, setStatusFiltro] = useState<KnowledgeBaseStatus | 'todos'>('todos')

  // Ações em andamento
  const [processandoId, setProcessandoId] = useState<string | null>(null)

  // Dialog Criar/Editar
  const [modalAberto, setModalAberto] = useState(false)
  const [itemEmEdicao, setItemEmEdicao] = useState<KnowledgeBaseEntry | null>(null)
  const [formCategoria, setFormCategoria] = useState<KnowledgeBaseCategory>('geral')
  const [formTitulo, setFormTitulo] = useState('')
  const [formPergunta, setFormPergunta] = useState('')
  const [formResposta, setFormResposta] = useState('')
  const [formFonte, setFormFonte] = useState('')

  const carregarMemoria = useCallback(async () => {
    if (!accountId) return
    setLoading(true)
    try {
      const lista = await listKnowledgeBase(accountId)
      setItens(lista)
    } catch (err: any) {
      console.error('[Memoria] Erro ao carregar fichas:', err)
      toast({
        title: 'Erro',
        description: 'Erro ao carregar a Memória da Clínica',
        variant: 'destructive',
      })
    } finally {
      setLoading(false)
    }
  }, [accountId])

  useEffect(() => {
    carregarMemoria()
  }, [carregarMemoria])

  const itensFiltrados = useMemo(() => {
    return itens.filter((item) => {
      if (categoriaFiltro !== 'todas' && item.categoria !== categoriaFiltro) return false
      if (statusFiltro !== 'todos' && item.status !== statusFiltro) return false
      if (busca.trim()) {
        const termo = busca.toLowerCase()
        const tituloMatch = item.titulo?.toLowerCase().includes(termo)
        const perguntaMatch = item.pergunta?.toLowerCase().includes(termo)
        const respostaMatch = item.resposta?.toLowerCase().includes(termo)
        const fonteMatch = item.fonte?.toLowerCase().includes(termo)
        if (!tituloMatch && !perguntaMatch && !respostaMatch && !fonteMatch) return false
      }
      return true
    })
  }, [itens, categoriaFiltro, statusFiltro, busca])

  // Contadores para métricas e destaques
  const totalPropostas = useMemo(() => itens.filter((i) => i.status === 'proposta').length, [itens])
  const totalAprovadas = useMemo(() => itens.filter((i) => i.status === 'aprovada').length, [itens])
  const totalArquivadas = useMemo(
    () => itens.filter((i) => i.status === 'arquivada').length,
    [itens],
  )
  const totalOrigemIa = useMemo(() => itens.filter((i) => i.origem === 'ia').length, [itens])

  const handleAbrirCriar = () => {
    setItemEmEdicao(null)
    setFormCategoria('geral')
    setFormTitulo('')
    setFormPergunta('')
    setFormResposta('')
    setFormFonte('Manual (equipe da clínica)')
    setModalAberto(true)
  }

  const handleAbrirEditar = (item: KnowledgeBaseEntry) => {
    setItemEmEdicao(item)
    setFormCategoria(item.categoria)
    setFormTitulo(item.titulo)
    setFormPergunta(item.pergunta || '')
    setFormResposta(item.resposta)
    setFormFonte(item.fonte || '')
    setModalAberto(true)
  }

  const handleSalvarModal = async () => {
    if (!accountId) return
    if (!formTitulo.trim() || !formResposta.trim()) {
      toast({
        title: 'Atenção',
        description: 'Título e resposta são obrigatórios',
        variant: 'destructive',
      })
      return
    }

    try {
      if (itemEmEdicao) {
        const atualizado = await updateKnowledgeBaseEntry(itemEmEdicao.id, {
          categoria: formCategoria,
          titulo: formTitulo.trim(),
          pergunta: formPergunta.trim(),
          resposta: formResposta.trim(),
          fonte: formFonte.trim(),
        })
        setItens((prev) => prev.map((i) => (i.id === atualizado.id ? atualizado : i)))
        toast({ title: `Ficha "${atualizado.titulo}" atualizada` })
      } else {
        const novo = await createKnowledgeBaseEntry(
          accountId,
          {
            categoria: formCategoria,
            titulo: formTitulo.trim(),
            pergunta: formPergunta.trim(),
            resposta: formResposta.trim(),
            fonte: formFonte.trim() || 'Manual (equipe da clínica)',
            status: 'aprovada',
            origem: 'humano',
          },
          user?.id,
        )
        setItens((prev) => [novo, ...prev])
        toast({ title: 'Nova ficha manual criada e aprovada' })
      }
      setModalAberto(false)
    } catch (err: any) {
      console.error('[Memoria] Erro ao salvar ficha:', err)
      toast({
        title: 'Erro',
        description: 'Falha ao salvar ficha: ' + (err?.message || 'Erro desconhecido'),
        variant: 'destructive',
      })
    }
  }

  const handleAprovar = async (item: KnowledgeBaseEntry) => {
    if (!user?.id) return
    setProcessandoId(item.id)
    try {
      const atualizado = await approveKnowledgeBaseEntry(item.id, user.id)
      setItens((prev) => prev.map((i) => (i.id === atualizado.id ? { ...i, ...atualizado } : i)))
      toast({ title: `Ficha "${item.titulo}" aprovada para a IA` })
    } catch (err: any) {
      console.error('[Memoria] Erro ao aprovar:', err)
      toast({
        title: 'Erro',
        description: 'Erro ao aprovar ficha',
        variant: 'destructive',
      })
    } finally {
      setProcessandoId(null)
    }
  }

  const handleArquivar = async (item: KnowledgeBaseEntry) => {
    setProcessandoId(item.id)
    try {
      const atualizado = await archiveKnowledgeBaseEntry(item.id)
      setItens((prev) =>
        prev.map((i) => (i.id === atualizado.id ? { ...i, status: 'arquivada' } : i)),
      )
      toast({ title: `Ficha "${item.titulo}" arquivada` })
    } catch (err: any) {
      console.error('[Memoria] Erro ao arquivar:', err)
      toast({
        title: 'Erro',
        description: 'Erro ao arquivar ficha',
        variant: 'destructive',
      })
    } finally {
      setProcessandoId(null)
    }
  }

  const handleExcluir = async (item: KnowledgeBaseEntry) => {
    if (!confirm(`Deseja realmente remover a ficha "${item.titulo}"?`)) return
    setProcessandoId(item.id)
    try {
      await deleteKnowledgeBaseEntry(item.id)
      setItens((prev) => prev.filter((i) => i.id !== item.id))
      toast({ title: 'Ficha removida' })
    } catch (err: any) {
      console.error('[Memoria] Erro ao excluir:', err)
      toast({
        title: 'Erro',
        description: 'Erro ao remover ficha',
        variant: 'destructive',
      })
    } finally {
      setProcessandoId(null)
    }
  }

  return (
    <div className="space-y-6 pb-12 max-w-6xl mx-auto">
      {/* Header com padrão visual v0.0.178 */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-border/60 pb-5">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl sm:text-3xl font-serif font-bold text-primary tracking-tight">
              Memória da Clínica · Base de Conhecimento
            </h1>
            <Badge
              variant="outline"
              className="bg-purple-100 text-purple-800 border-purple-200 text-xs font-semibold flex items-center gap-1 shrink-0"
            >
              <Brain className="w-3 h-3 text-purple-600" />
              Cérebro da Fabiana
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground mt-1.5 max-w-3xl">
            Fichas oficiais sobre preços, horários, unidades, suplementos e condutas da clínica.{' '}
            <strong>Nada é automático</strong>: propostas geradas pela IA a partir de áudios e
            conversas precisam de aprovação humana da secretária ou Dr. Caio antes de serem usadas
            nas respostas.
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <Button
            variant="outline"
            size="sm"
            onClick={carregarMemoria}
            disabled={loading}
            className="gap-2 rounded-xl"
          >
            <RefreshCw className={cn('w-4 h-4', loading && 'animate-spin')} />
            Atualizar
          </Button>

          <Button
            size="sm"
            onClick={handleAbrirCriar}
            className="gap-2 rounded-xl bg-primary text-primary-foreground hover:bg-primary/90"
          >
            <Plus className="w-4 h-4" />
            Nova Ficha Manual
          </Button>
        </div>
      </div>

      {/* Faixa LGPD e Garantia de Privacidade */}
      <div className="bg-emerald-50/70 border border-emerald-200/80 rounded-2xl p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-emerald-900">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-emerald-100 text-emerald-700 shrink-0">
            <ShieldCheck className="w-5 h-5" />
          </div>
          <div className="text-xs space-y-0.5">
            <p className="font-semibold text-emerald-950 flex items-center gap-1.5">
              <Lock className="w-3.5 h-3.5 text-emerald-700" />
              Conformidade LGPD · 100% On-Premise e Interno
            </p>
            <p className="text-emerald-800/90 leading-relaxed">
              Toda a base de conhecimento reside no banco seguro do CRM. Nenhuma informação médica
              ou de paciente sai da infraestrutura da clínica. Respostas validadas orientam o Modo
              Plantão e o atendimento diário.
            </p>
          </div>
        </div>
      </div>

      {/* Métricas do Cérebro */}
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-24 rounded-2xl" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
          <Card
            className={cn(
              'rounded-2xl border-border/60 shadow-xs cursor-pointer transition-colors',
              statusFiltro === 'proposta' && 'border-amber-400 bg-amber-50/30',
            )}
            onClick={() => setStatusFiltro(statusFiltro === 'proposta' ? 'todos' : 'proposta')}
          >
            <CardContent className="p-4 flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-amber-100 text-amber-800">
                <AlertCircle className="w-5 h-5" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground font-medium">
                  Propostas da IA (Revisar)
                </p>
                <p className="text-2xl font-bold font-serif text-amber-700">{totalPropostas}</p>
                <p className="text-[10px] text-muted-foreground">Aguardando aprovação humana</p>
              </div>
            </CardContent>
          </Card>

          <Card
            className={cn(
              'rounded-2xl border-border/60 shadow-xs cursor-pointer transition-colors',
              statusFiltro === 'aprovada' && 'border-emerald-400 bg-emerald-50/30',
            )}
            onClick={() => setStatusFiltro(statusFiltro === 'aprovada' ? 'todos' : 'aprovada')}
          >
            <CardContent className="p-4 flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-emerald-100 text-emerald-800">
                <BookmarkCheck className="w-5 h-5" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground font-medium">Fichas Aprovadas</p>
                <p className="text-2xl font-bold font-serif text-emerald-700">{totalAprovadas}</p>
                <p className="text-[10px] text-muted-foreground">Ativas no cérebro da clínica</p>
              </div>
            </CardContent>
          </Card>

          <Card
            className="rounded-2xl border-border/60 shadow-xs cursor-pointer transition-colors"
            onClick={() => setStatusFiltro('todos')}
          >
            <CardContent className="p-4 flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-purple-100 text-purple-800">
                <Sparkles className="w-5 h-5" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground font-medium">
                  Origem IA (Áudios/Conversas)
                </p>
                <p className="text-2xl font-bold font-serif text-purple-700">{totalOrigemIa}</p>
                <p className="text-[10px] text-muted-foreground">Sintetizadas pela IA</p>
              </div>
            </CardContent>
          </Card>

          <Card
            className={cn(
              'rounded-2xl border-border/60 shadow-xs cursor-pointer transition-colors',
              statusFiltro === 'arquivada' && 'border-slate-400 bg-slate-50/50',
            )}
            onClick={() => setStatusFiltro(statusFiltro === 'arquivada' ? 'todos' : 'arquivada')}
          >
            <CardContent className="p-4 flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-slate-100 text-slate-700">
                <Archive className="w-5 h-5" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground font-medium">Fichas Arquivadas</p>
                <p className="text-2xl font-bold font-serif text-slate-700">{totalArquivadas}</p>
                <p className="text-[10px] text-muted-foreground">Histórico inativo</p>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Destaque de Revisão Urgente: Propostas da IA */}
      {totalPropostas > 0 && statusFiltro !== 'proposta' && (
        <div className="p-4 rounded-2xl bg-gradient-to-r from-amber-50 to-orange-50 border border-amber-200/80 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-amber-100 text-amber-800 shrink-0">
              <AlertCircle className="w-5 h-5" />
            </div>
            <div>
              <p className="text-sm font-semibold text-amber-950">
                Você tem {totalPropostas}{' '}
                {totalPropostas === 1 ? 'ficha proposta' : 'fichas propostas'} pela IA aguardando
                revisão humana
              </p>
              <p className="text-xs text-amber-900/80">
                A IA identificou novos padrões nos áudios e conversas da Fabiana. Revise e aprove
                para oficializar.
              </p>
            </div>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setStatusFiltro('proposta')}
            className="rounded-xl border-amber-300 text-amber-900 hover:bg-amber-100 text-xs shrink-0"
          >
            Filtrar Apenas Propostas ({totalPropostas})
          </Button>
        </div>
      )}

      {/* Barra de Filtros e Busca */}
      <div className="space-y-3">
        <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center justify-between">
          <div className="relative flex-1 max-w-md">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Buscar pergunta, resposta, título ou fonte..."
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              className="pl-9 rounded-xl text-sm"
            />
          </div>

          <div className="flex items-center gap-2">
            <Select
              value={statusFiltro}
              onValueChange={(val) => setStatusFiltro(val as KnowledgeBaseStatus | 'todos')}
            >
              <SelectTrigger className="w-[170px] rounded-xl text-xs h-9">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos os Status</SelectItem>
                <SelectItem value="proposta">Proposta (Revisar)</SelectItem>
                <SelectItem value="aprovada">Aprovada</SelectItem>
                <SelectItem value="arquivada">Arquivada</SelectItem>
              </SelectContent>
            </Select>

            {statusFiltro !== 'todos' && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setStatusFiltro('todos')}
                className="text-xs text-muted-foreground h-9 px-2"
              >
                Limpar status
              </Button>
            )}
          </div>
        </div>

        {/* Pílulas de Categoria */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-thin">
          <Button
            size="sm"
            variant={categoriaFiltro === 'todas' ? 'default' : 'outline'}
            onClick={() => setCategoriaFiltro('todas')}
            className="rounded-full text-xs h-8 shrink-0"
          >
            Todas ({itens.length})
          </Button>

          {(Object.keys(CATEGORIAS_KNOWLEDGE_BASE) as KnowledgeBaseCategory[]).map((catKey) => {
            const meta = CATEGORIAS_KNOWLEDGE_BASE[catKey]
            const Icon = meta.icon
            const qtd = itens.filter((i) => i.categoria === catKey).length
            const ativa = categoriaFiltro === catKey
            return (
              <Button
                key={catKey}
                size="sm"
                variant={ativa ? 'default' : 'outline'}
                onClick={() => setCategoriaFiltro(catKey)}
                className={cn(
                  'rounded-full text-xs h-8 shrink-0 gap-1.5',
                  !ativa && 'text-muted-foreground',
                )}
              >
                <Icon className="w-3.5 h-3.5" />
                {meta.label} ({qtd})
              </Button>
            )
          })}
        </div>
      </div>

      {/* Lista de Fichas */}
      {loading ? (
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-44 rounded-2xl" />
          ))}
        </div>
      ) : itensFiltrados.length === 0 ? (
        <div className="p-12 text-center border border-dashed rounded-2xl bg-muted/20">
          <Brain className="w-10 h-10 text-muted-foreground mx-auto mb-3 opacity-50" />
          <h3 className="font-serif font-semibold text-lg text-foreground">
            Nenhuma ficha encontrada
          </h3>
          <p className="text-xs text-muted-foreground mt-1 max-w-md mx-auto">
            {busca || categoriaFiltro !== 'todas' || statusFiltro !== 'todos'
              ? 'Tente ajustar os filtros ou a busca digitada acima.'
              : 'Cadastre a primeira ficha de conhecimento manual da clínica.'}
          </p>
          <Button size="sm" onClick={handleAbrirCriar} className="mt-4 rounded-xl text-xs gap-1.5">
            <Plus className="w-3.5 h-3.5" />
            Criar Ficha Manual
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {itensFiltrados.map((item) => {
            const catMeta =
              CATEGORIAS_KNOWLEDGE_BASE[item.categoria] || CATEGORIAS_KNOWLEDGE_BASE.geral
            const CatIcon = catMeta.icon
            const isProposta = item.status === 'proposta'
            const isAprovada = item.status === 'aprovada'
            const isArquivada = item.status === 'arquivada'
            const isOrigemIa = item.origem === 'ia'
            const ocupado = processandoId === item.id

            return (
              <Card
                key={item.id}
                className={cn(
                  'rounded-2xl transition-all border-border/70 overflow-hidden shadow-xs',
                  isProposta && 'border-amber-400 bg-amber-50/15 ring-1 ring-amber-300/40',
                  isArquivada && 'opacity-65 bg-slate-50/50',
                )}
              >
                <CardHeader className="p-4 sm:p-5 pb-3 bg-slate-50/60 border-b border-border/40">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge
                        variant="outline"
                        className={cn(
                          'text-xs font-semibold px-2.5 py-0.5 gap-1',
                          catMeta.corBadge,
                        )}
                      >
                        <CatIcon className="w-3 h-3" />
                        {catMeta.label}
                      </Badge>

                      {/* Badge Origem (IA / Humano) */}
                      {isOrigemIa ? (
                        <Badge
                          variant="secondary"
                          className="bg-purple-100 text-purple-900 border-purple-200 text-[11px] font-semibold flex items-center gap-1"
                        >
                          <Sparkles className="w-3 h-3 text-purple-600" />
                          Origem: IA
                        </Badge>
                      ) : (
                        <Badge
                          variant="secondary"
                          className="bg-emerald-100 text-emerald-900 border-emerald-200 text-[11px] font-semibold flex items-center gap-1"
                        >
                          <User className="w-3 h-3 text-emerald-600" />
                          Origem: Humano
                        </Badge>
                      )}

                      {/* Badge Status */}
                      {isProposta && (
                        <Badge
                          variant="outline"
                          className="bg-amber-100 text-amber-900 border-amber-300 text-[11px] font-semibold flex items-center gap-1"
                        >
                          <AlertCircle className="w-3 h-3 text-amber-600" />
                          Proposta da IA (Revisão Pendente)
                        </Badge>
                      )}

                      {isAprovada && (
                        <Badge
                          variant="outline"
                          className="bg-emerald-50 text-emerald-800 border-emerald-200 text-[11px] font-medium flex items-center gap-1"
                        >
                          <Check className="w-3 h-3 text-emerald-600" />
                          Oficial Aprovada
                        </Badge>
                      )}

                      {isArquivada && (
                        <Badge
                          variant="outline"
                          className="bg-slate-100 text-slate-700 border-slate-300 text-[11px] font-medium"
                        >
                          Arquivada
                        </Badge>
                      )}
                    </div>

                    {/* Ações Rápidas */}
                    <div className="flex items-center gap-1.5 self-end sm:self-auto">
                      {isProposta && (
                        <Button
                          size="sm"
                          onClick={() => handleAprovar(item)}
                          disabled={ocupado}
                          className="h-8 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs gap-1 px-3 shadow-xs"
                        >
                          <Check className="w-3.5 h-3.5" />
                          Aprovar Ficha
                        </Button>
                      )}

                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleAbrirEditar(item)}
                        disabled={ocupado}
                        className="h-8 rounded-xl text-xs gap-1 px-2.5 text-muted-foreground hover:text-foreground"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                        Editar
                      </Button>

                      {!isArquivada ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => handleArquivar(item)}
                          disabled={ocupado}
                          className="h-8 rounded-xl text-xs gap-1 px-2.5 text-muted-foreground hover:text-foreground"
                        >
                          <Archive className="w-3.5 h-3.5" />
                          Arquivar
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => handleAprovar(item)}
                          disabled={ocupado}
                          className="h-8 rounded-xl text-xs gap-1 px-2.5 text-emerald-700 hover:bg-emerald-50"
                        >
                          <Check className="w-3.5 h-3.5" />
                          Reativar
                        </Button>
                      )}

                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleExcluir(item)}
                        disabled={ocupado}
                        className="h-8 rounded-xl text-xs gap-1 px-2 text-rose-600 hover:bg-rose-50"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>
                </CardHeader>

                <CardContent className="p-4 sm:p-5 space-y-3">
                  <div>
                    <h3 className="font-serif font-semibold text-base text-foreground tracking-tight">
                      {item.titulo}
                    </h3>

                    {item.pergunta && (
                      <p className="text-xs text-muted-foreground mt-1 flex items-start gap-1.5">
                        <HelpCircle className="w-3.5 h-3.5 text-primary shrink-0 mt-0.5" />
                        <span>
                          <strong>Dúvida comum:</strong> {item.pergunta}
                        </span>
                      </p>
                    )}
                  </div>

                  {/* Resposta Oficial */}
                  <div className="p-3.5 rounded-xl bg-slate-50 border border-border/60 text-sm text-foreground/90 font-sans leading-relaxed whitespace-pre-wrap">
                    {item.resposta}
                  </div>

                  {/* Rodapé da Ficha: Fonte & Aprovação */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 text-[11px] text-muted-foreground pt-1 border-t border-border/40">
                    <div>
                      {item.fonte && (
                        <span>
                          <strong>Fonte:</strong> {item.fonte}
                        </span>
                      )}
                    </div>
                    <div>
                      {item.approved_at && (
                        <span className="text-emerald-700 font-medium">
                          ✓ Aprovado em {new Date(item.approved_at).toLocaleDateString('pt-BR')} às{' '}
                          {new Date(item.approved_at).toLocaleTimeString('pt-BR', {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </span>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {/* Dialog Criar / Editar Ficha */}
      <Dialog open={modalAberto} onOpenChange={setModalAberto}>
        <DialogContent className="sm:max-w-lg rounded-2xl">
          <DialogHeader>
            <DialogTitle className="font-serif text-xl">
              {itemEmEdicao ? 'Editar Ficha da Memória' : 'Nova Ficha Manual'}
            </DialogTitle>
            <DialogDescription className="text-xs">
              As informações salvas são usadas pelas automações e pelo Modo Plantão como verdade
              oficial da clínica.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3.5 py-2">
            <div className="space-y-1">
              <label className="text-xs font-semibold text-muted-foreground">Categoria:</label>
              <Select
                value={formCategoria}
                onValueChange={(val) => setFormCategoria(val as KnowledgeBaseCategory)}
              >
                <SelectTrigger className="rounded-xl text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(CATEGORIAS_KNOWLEDGE_BASE) as KnowledgeBaseCategory[]).map(
                    (cat) => (
                      <SelectItem key={cat} value={cat}>
                        {CATEGORIAS_KNOWLEDGE_BASE[cat].label}
                      </SelectItem>
                    ),
                  )}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-semibold text-muted-foreground">
                Título / Tópico:
              </label>
              <Input
                placeholder="Ex.: Valor da Consulta em Alfenas"
                value={formTitulo}
                onChange={(e) => setFormTitulo(e.target.value)}
                className="rounded-xl text-sm"
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-semibold text-muted-foreground">
                Pergunta do Paciente (Opcional):
              </label>
              <Input
                placeholder="Ex.: Quanto custa a consulta com o Dr. Caio?"
                value={formPergunta}
                onChange={(e) => setFormPergunta(e.target.value)}
                className="rounded-xl text-sm"
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-semibold text-muted-foreground">
                Resposta Oficial da Clínica:
              </label>
              <Textarea
                placeholder="Escreva a resposta clara e acolhedora com os detalhes exatos..."
                value={formResposta}
                onChange={(e) => setFormResposta(e.target.value)}
                rows={4}
                className="rounded-xl text-sm resize-y"
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-semibold text-muted-foreground">
                Fonte / Origem da Informação:
              </label>
              <Input
                placeholder="Ex.: Dr. Caio / Regra da recepção"
                value={formFonte}
                onChange={(e) => setFormFonte(e.target.value)}
                className="rounded-xl text-sm"
              />
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setModalAberto(false)}
              className="rounded-xl text-xs"
            >
              Cancelar
            </Button>
            <Button
              type="button"
              onClick={handleSalvarModal}
              className="rounded-xl text-xs gap-1.5 bg-primary text-primary-foreground"
            >
              <Check className="w-3.5 h-3.5" />
              {itemEmEdicao ? 'Salvar Alterações' : 'Criar e Aprovar Ficha'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
export default Memoria
