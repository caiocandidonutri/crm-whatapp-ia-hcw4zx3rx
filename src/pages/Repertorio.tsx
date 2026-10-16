import React, { useState, useEffect, useCallback } from 'react'
import {
  Sparkles,
  Check,
  Trash2,
  RefreshCw,
  ShieldCheck,
  Users,
  MessageSquare,
  Bot,
  Info,
  Pencil,
  ArrowRight,
  Headphones,
  CheckCircle2,
  Lock,
} from 'lucide-react'
import { useCurrentAccount } from '@/hooks/use-current-account'
import {
  analisarRepertorioFabiana,
  type RepertorioAnaliseResultado,
  type RepertorioSugestao,
  REPERTORIO_CATEGORIAS_META,
  type RepertorioCategoria,
} from '@/services/repertorio_service'
import { createMessageTemplate, getMessageTemplates } from '@/services/message_templates'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { toast } from 'sonner'
import { Link } from 'react-router-dom'
import { cn } from '@/lib/utils'

export default function Repertorio() {
  const { account, accountId } = useCurrentAccount()
  const [loading, setLoading] = useState(true)
  const [resultado, setResultado] = useState<RepertorioAnaliseResultado | null>(null)
  const [sugestoes, setSugestoes] = useState<RepertorioSugestao[]>([])
  const [edicoes, setEdicoes] = useState<Record<string, { titulo: string; texto: string }>>({})
  const [editandoId, setEditandoId] = useState<string | null>(null)
  const [aprovandoId, setAprovandoId] = useState<string | null>(null)
  const [aprovados, setAprovados] = useState<Set<string>>(new Set())
  const [categoriaAtiva, setCategoriaAtiva] = useState<RepertorioCategoria | 'todas'>('todas')

  const carregarRepertorio = useCallback(async () => {
    if (!accountId) return
    setLoading(true)
    try {
      const res = await analisarRepertorioFabiana(accountId)
      setResultado(res)
      setSugestoes(res.sugestoes)

      // Inicializa estados de edição
      const inicial: Record<string, { titulo: string; texto: string }> = {}
      for (const s of res.sugestoes) {
        inicial[s.id] = {
          titulo: s.tituloSugerido,
          texto: s.textoProposto,
        }
      }
      setEdicoes(inicial)

      // Identifica templates já salvos como Voz da Fabiana para marcar aprovados
      const templatesExistentes = await getMessageTemplates(accountId)
      const nomesExistentes = new Set(templatesExistentes.map((t) => t.name.toLowerCase().trim()))
      const jaAprovados = new Set<string>()

      for (const s of res.sugestoes) {
        if (
          nomesExistentes.has(s.tituloSugerido.toLowerCase().trim()) ||
          templatesExistentes.some(
            (t) =>
              t.is_fabiana_voice &&
              t.content.trim().substring(0, 30) === s.textoProposto.trim().substring(0, 30),
          )
        ) {
          jaAprovados.add(s.id)
        }
      }
      setAprovados(jaAprovados)
    } catch (err) {
      console.error('[Repertorio] falha na análise:', err)
      toast.error('Erro ao analisar repertório da Fabiana')
    } finally {
      setLoading(false)
    }
  }, [accountId])

  useEffect(() => {
    carregarRepertorio()
  }, [carregarRepertorio])

  const handleSalvarEdicao = (id: string) => {
    setEditandoId(null)
    toast.success('Alterações mantidas no rascunho de revisão')
  }

  const handleAprovarESalvar = async (sugestao: RepertorioSugestao) => {
    if (!accountId) return
    const edicao = edicoes[sugestao.id] || {
      titulo: sugestao.tituloSugerido,
      texto: sugestao.textoProposto,
    }

    if (!edicao.titulo.trim() || !edicao.texto.trim()) {
      toast.error('Título e texto não podem ficar vazios')
      return
    }

    setAprovandoId(sugestao.id)
    try {
      await createMessageTemplate(accountId, {
        name: edicao.titulo.trim(),
        trigger_type: sugestao.triggerType,
        content: edicao.texto.trim(),
        is_fabiana_voice: true,
      })

      setAprovados((prev) => new Set([...prev, sugestao.id]))
      toast.success(
        `Modelo "${edicao.titulo}" aprovado e salvo em Modelos de Mensagem com a Voz da Fabiana!`,
      )
    } catch (err: any) {
      console.error('[Repertorio] erro ao salvar template:', err)
      toast.error('Erro ao aprovar modelo: ' + (err?.message || 'Falha de gravação'))
    } finally {
      setAprovandoId(null)
    }
  }

  const handleDescartar = (id: string) => {
    setSugestoes((prev) => prev.filter((s) => s.id !== id))
    toast.info('Sugestão descartada da revisão')
  }

  const sugestoesFiltradas = sugestoes.filter((s) => {
    if (categoriaAtiva === 'todas') return true
    return s.categoria === categoriaAtiva
  })

  return (
    <div className="space-y-6 pb-12 max-w-6xl mx-auto">
      {/* Header com badge LGPD e explicação */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-border/60 pb-5">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl sm:text-3xl font-serif font-bold text-primary tracking-tight">
              Análise de Repertório · Voz da Fabiana
            </h1>
            <Badge
              variant="outline"
              className="bg-purple-100 text-purple-800 border-purple-200 text-xs font-semibold flex items-center gap-1 shrink-0"
            >
              <Sparkles className="w-3 h-3 text-purple-600" />
              IA & Tom de Voz
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground mt-1.5 max-w-3xl">
            A IA analisa as mensagens e áudios reais enviados pela Fabiana às pacientes e sugere
            modelos oficiais divididos pelas etapas do atendimento.{' '}
            <strong>Nada é salvo automaticamente</strong>: você revisa, edita cada palavra e só
            aprova o que estiver de acordo.
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <Button
            variant="outline"
            size="sm"
            onClick={carregarRepertorio}
            disabled={loading}
            className="gap-2 rounded-xl"
          >
            <RefreshCw className={cn('w-4 h-4', loading && 'animate-spin')} />
            Recalcular Análise
          </Button>

          <Button asChild size="sm" variant="secondary" className="gap-2 rounded-xl">
            <Link to="/integracoes">
              Ver Modelos Ativos
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
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
              Conformidade LGPD · 100% On-Premise / CRM Interno
            </p>
            <p className="text-emerald-800/90 leading-relaxed">
              A análise utiliza{' '}
              <strong>somente mensagens enviadas pelo consultório (from_me)</strong>. Nenhum dado
              sensível de paciente sai do CRM. Os exemplos reais são exibidos com primeiro nome
              anonimizado.
            </p>
          </div>
        </div>
      </div>

      {/* Métricas do Snapshot de Análise */}
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-24 rounded-2xl" />
          ))}
        </div>
      ) : resultado ? (
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
          <Card className="rounded-2xl border-border/60 shadow-xs">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-primary/10 text-primary">
                <Users className="w-5 h-5" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground font-medium">Pacientes Analisadas</p>
                <p className="text-2xl font-bold font-serif text-primary">
                  {resultado.totalPacientesAnalisadas}
                </p>
                <p className="text-[10px] text-muted-foreground">Últimas conversas com a Fabiana</p>
              </div>
            </CardContent>
          </Card>

          <Card className="rounded-2xl border-border/60 shadow-xs">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-blue-100 text-blue-700">
                <MessageSquare className="w-5 h-5" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground font-medium">Leads no Pipeline</p>
                <p className="text-2xl font-bold font-serif text-foreground">
                  {resultado.contagemPorEstagio.leads}
                </p>
                <p className="text-[10px] text-muted-foreground">Etapa inicial de acolhimento</p>
              </div>
            </CardContent>
          </Card>

          <Card className="rounded-2xl border-border/60 shadow-xs">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-teal-100 text-teal-700">
                <CheckCircle2 className="w-5 h-5" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground font-medium">Em Consulta / Retorno</p>
                <p className="text-2xl font-bold font-serif text-foreground">
                  {resultado.contagemPorEstagio.consultaRetorno}
                </p>
                <p className="text-[10px] text-muted-foreground">Acompanhamento ativo</p>
              </div>
            </CardContent>
          </Card>

          <Card className="rounded-2xl border-border/60 shadow-xs">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-amber-100 text-amber-700">
                <Headphones className="w-5 h-5" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground font-medium">Recorrência & Áudios</p>
                <p className="text-2xl font-bold font-serif text-foreground">
                  {resultado.contagemPorEstagio.recorrencia}
                </p>
                <p className="text-[10px] text-muted-foreground">Pacientes convertidas</p>
              </div>
            </CardContent>
          </Card>
        </div>
      ) : null}

      {/* Filtros de Categoria */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-2 scrollbar-thin">
        <Button
          size="sm"
          variant={categoriaAtiva === 'todas' ? 'default' : 'outline'}
          onClick={() => setCategoriaAtiva('todas')}
          className="rounded-full text-xs h-8"
        >
          Todas as Categorias ({sugestoes.length})
        </Button>
        {Object.values(REPERTORIO_CATEGORIAS_META).map((cat) => {
          const qtd = sugestoes.filter((s) => s.categoria === cat.key).length
          const ativa = categoriaAtiva === cat.key
          return (
            <Button
              key={cat.key}
              size="sm"
              variant={ativa ? 'default' : 'outline'}
              onClick={() => setCategoriaAtiva(cat.key)}
              className={cn('rounded-full text-xs h-8 shrink-0', !ativa && 'text-muted-foreground')}
            >
              {cat.label} ({qtd})
            </Button>
          )
        })}
      </div>

      {/* Lista de Sugestões de Modelos */}
      {loading ? (
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-56 rounded-2xl" />
          ))}
        </div>
      ) : sugestoesFiltradas.length === 0 ? (
        <div className="p-12 text-center border border-dashed rounded-2xl bg-muted/20">
          <Sparkles className="w-8 h-8 text-muted-foreground mx-auto mb-3 opacity-60" />
          <h3 className="font-serif font-semibold text-lg text-foreground">
            Nenhuma sugestão encontrada
          </h3>
          <p className="text-xs text-muted-foreground mt-1">
            Alterne o filtro ou clique em "Recalcular Análise" para buscar novos padrões.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-5">
          {sugestoesFiltradas.map((sugestao) => {
            const meta = REPERTORIO_CATEGORIAS_META[sugestao.categoria]
            const isEditing = editandoId === sugestao.id
            const isApproved = aprovados.has(sugestao.id)
            const edicaoAtual = edicoes[sugestao.id] || {
              titulo: sugestao.tituloSugerido,
              texto: sugestao.textoProposto,
            }

            return (
              <Card
                key={sugestao.id}
                className={cn(
                  'rounded-2xl transition-all border-border/70 overflow-hidden shadow-xs',
                  isApproved && 'border-emerald-300 bg-emerald-50/20',
                )}
              >
                <CardHeader className="p-5 pb-3 bg-slate-50/50 border-b border-border/40">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div className="flex items-center gap-2.5 flex-wrap">
                      <Badge
                        variant="outline"
                        className={cn('text-xs font-semibold px-2.5 py-0.5', meta.corBadge)}
                      >
                        {meta.label}
                      </Badge>

                      <Badge
                        variant="secondary"
                        className="bg-purple-100 text-purple-800 border-purple-200 text-[11px] font-semibold flex items-center gap-1"
                      >
                        <Sparkles className="w-3 h-3 text-purple-600" />
                        Voz da Fabiana
                      </Badge>

                      <span className="text-xs text-muted-foreground">
                        Usado em ~<strong>{sugestao.contagemUso}</strong> conversas reais
                      </span>

                      {sugestao.estagiosDetectados.length > 0 && (
                        <span className="text-[11px] text-muted-foreground/80 bg-white px-2 py-0.5 rounded-md border border-border/40">
                          Estágios: {sugestao.estagiosDetectados.join(', ')}
                        </span>
                      )}
                    </div>

                    {isApproved ? (
                      <Badge className="bg-emerald-600 hover:bg-emerald-600 text-white text-xs gap-1 py-1 px-3">
                        <Check className="w-3.5 h-3.5" />
                        Salvo no CRM
                      </Badge>
                    ) : (
                      <span className="text-xs text-amber-700 bg-amber-50 px-2.5 py-1 rounded-full font-medium border border-amber-200 shrink-0">
                        Pendente de Aprovação
                      </span>
                    )}
                  </div>
                </CardHeader>

                <CardContent className="p-5 space-y-4">
                  {/* Título e Texto Proposto */}
                  <div className="space-y-2">
                    {isEditing ? (
                      <div className="space-y-3">
                        <div className="space-y-1">
                          <label className="text-xs font-semibold text-muted-foreground">
                            Título do Modelo:
                          </label>
                          <Input
                            value={edicaoAtual.titulo}
                            onChange={(e) =>
                              setEdicoes((prev) => ({
                                ...prev,
                                [sugestao.id]: { ...edicaoAtual, titulo: e.target.value },
                              }))
                            }
                            className="text-sm font-medium"
                          />
                        </div>

                        <div className="space-y-1">
                          <label className="text-xs font-semibold text-muted-foreground">
                            Texto do Modelo (Variáveis: {'{nome}'}, {'{horario}'}, {'{data}'}):
                          </label>
                          <Textarea
                            value={edicaoAtual.texto}
                            onChange={(e) =>
                              setEdicoes((prev) => ({
                                ...prev,
                                [sugestao.id]: { ...edicaoAtual, texto: e.target.value },
                              }))
                            }
                            className="text-sm min-h-[90px] resize-y"
                          />
                        </div>

                        <div className="flex justify-end gap-2 pt-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setEditandoId(null)}
                            className="rounded-xl text-xs"
                          >
                            Cancelar
                          </Button>
                          <Button
                            size="sm"
                            onClick={() => handleSalvarEdicao(sugestao.id)}
                            className="rounded-xl text-xs gap-1.5"
                          >
                            <Check className="w-3.5 h-3.5" />
                            Aplicar Edição
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between">
                          <h3 className="font-semibold text-sm text-foreground">
                            {edicaoAtual.titulo}
                          </h3>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setEditandoId(sugestao.id)}
                            className="h-7 text-xs text-muted-foreground hover:text-foreground gap-1 px-2"
                          >
                            <Pencil className="w-3 h-3" />
                            Editar texto
                          </Button>
                        </div>
                        <div className="p-3.5 rounded-xl bg-slate-50 border border-border/60 text-sm text-foreground/90 font-sans leading-relaxed whitespace-pre-wrap">
                          {edicaoAtual.texto}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Exemplos reais encontrados da Fabiana (LGPD Anonimizado) */}
                  {sugestao.exemplosReais.length > 0 && (
                    <div className="space-y-1.5 pt-1">
                      <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                        <Bot className="w-3.5 h-3.5 text-primary" />
                        Exemplos Reais Enviados pela Fabiana (LGPD Anonimizado):
                      </p>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                        {sugestao.exemplosReais.map((ex, idx) => (
                          <div
                            key={idx}
                            className="p-2.5 rounded-lg bg-white border border-border/50 text-xs text-muted-foreground flex flex-col justify-between"
                          >
                            <p className="italic text-foreground/80">"{ex.textoOriginal}"</p>
                            <div className="mt-2 pt-1 border-t border-border/30 flex items-center justify-between text-[10px] text-muted-foreground/70">
                              <span>
                                Paciente: <strong>{ex.pacientePrimeiroNome}</strong>
                              </span>
                              <Badge
                                variant="outline"
                                className="text-[9px] px-1 py-0 h-4 uppercase"
                              >
                                {ex.tipo === 'audio_transcrito'
                                  ? 'Áudio transcrito'
                                  : 'Mensagem texto'}
                              </Badge>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Barra de Ações: Aprovar / Descartar */}
                  <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-3 border-t border-border/40">
                    <p className="text-[11px] text-muted-foreground leading-tight text-center sm:text-left">
                      Ao aprovar, este modelo será registrado com a tag{' '}
                      <span className="font-semibold text-purple-700">Voz da Fabiana</span> e ficará
                      disponível no seletor de templates e nos prompts de IA.
                    </p>

                    <div className="flex items-center gap-2 shrink-0 w-full sm:w-auto justify-end">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleDescartar(sugestao.id)}
                        className="text-xs text-muted-foreground hover:text-destructive rounded-xl gap-1"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        Descartar
                      </Button>

                      <Button
                        size="sm"
                        onClick={() => handleAprovarESalvar(sugestao)}
                        disabled={aprovandoId === sugestao.id || isApproved}
                        className={cn(
                          'rounded-xl text-xs gap-1.5 font-semibold shadow-xs',
                          isApproved
                            ? 'bg-emerald-600 hover:bg-emerald-600 text-white'
                            : 'bg-primary hover:bg-primary/90 text-primary-foreground',
                        )}
                      >
                        <Check className="w-3.5 h-3.5" />
                        {isApproved ? 'Aprovado' : 'Aprovar & Salvar'}
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
