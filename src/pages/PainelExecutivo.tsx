import React, { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  TrendingUp,
  UserX,
  Target,
  RotateCcw,
  Crown,
  Sparkles,
  HelpCircle,
  RefreshCw,
  ArrowRight,
  DollarSign,
  Calendar,
  CheckCircle2,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { useCurrentAccount } from '@/hooks/use-current-account'
import { isNetworkError } from '@/lib/pocketbase/errors'
import {
  fetchExecutiveMetrics,
  DEFAULT_EXECUTIVE_METRICS,
  type ExecutiveMetrics,
} from '@/services/executive_dashboard_service'

export function PainelExecutivo() {
  const navigate = useNavigate()
  const { currentAccount, loading: accountLoading } = useCurrentAccount()
  const accountId = currentAccount?.id || ''

  const [loading, setLoading] = useState(true)
  const [metrics, setMetrics] = useState<ExecutiveMetrics>(DEFAULT_EXECUTIVE_METRICS)

  const loadData = useCallback(async () => {
    if (!accountId) {
      // Se não há conta ou ainda está carregando a conta, mantemos estado seguro
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const data = await fetchExecutiveMetrics(accountId)
      setMetrics(data || DEFAULT_EXECUTIVE_METRICS)
    } catch (err) {
      if (!isNetworkError(err)) {
        console.warn('[PainelExecutivo] Erro silencioso ao carregar métricas:', err)
      }
      setMetrics(DEFAULT_EXECUTIVE_METRICS)
    } finally {
      setLoading(false)
    }
  }, [accountId])

  useEffect(() => {
    if (!accountLoading) {
      loadData()
    }
  }, [loadData, accountLoading])

  const safeMetrics = metrics || DEFAULT_EXECUTIVE_METRICS

  const renderValue = (val: number | null | undefined, suffix = '') => {
    if (loading || accountLoading) return '—'
    if (val === null || val === undefined || isNaN(val)) return '—'
    return `${val}${suffix}`
  }

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl sm:text-3xl font-serif font-bold tracking-tight text-foreground">
              Dashboard Executivo
            </h1>
            <Badge
              variant="outline"
              className="bg-primary/5 text-primary border-primary/20 text-xs font-semibold"
            >
              Bloco Gestão
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            <strong>Painel Gerencial da Clínica do Dr. Caio.</strong> Visão estratégica de no-show,
            conversão de novos contatos, recall de retorno e penetração do Clube de Saúde.
          </p>
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto">
          <Button
            variant="outline"
            size="sm"
            onClick={loadData}
            disabled={loading}
            className="gap-2"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            <span className="hidden sm:inline">Atualizar KPIs</span>
          </Button>

          <Button
            size="sm"
            onClick={() => navigate('/financeiro')}
            className="gap-2 bg-primary text-primary-foreground shadow-sm ml-auto sm:ml-0"
          >
            <DollarSign className="w-4 h-4" />
            <span>Ver Financeiro</span>
          </Button>
        </div>
      </div>

      {/* 5 CARTOES EXECUTIVOS CLICÁVEIS */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
        {/* Card 1: No-Show % */}
        <Card
          onClick={() => navigate('/agenda')}
          className="border border-border/70 shadow-xs hover:border-primary/50 hover:shadow-sm transition-all cursor-pointer group"
        >
          <CardHeader className="p-4 pb-2 flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground group-hover:text-primary transition-colors">
              Taxa de No-Show
            </CardTitle>
            <div className="p-2 rounded-xl bg-rose-500/10 text-rose-700">
              <UserX className="w-4 h-4" />
            </div>
          </CardHeader>
          <CardContent className="p-4 pt-1">
            <div className="text-2xl font-bold font-serif text-foreground">
              {renderValue(safeMetrics.noShowPercent, '%')}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {safeMetrics.totalFaltas ?? 0} falta(s) em {safeMetrics.totalConsultasAvaliadas ?? 0}{' '}
              consulta(s)
            </p>
            <div className="pt-2 flex items-center text-[11px] font-medium text-primary gap-1 group-hover:translate-x-0.5 transition-transform">
              <span>Abrir Agenda</span>
              <ArrowRight className="w-3 h-3" />
            </div>
          </CardContent>
        </Card>

        {/* Card 2: Conversão de Leads */}
        <Card
          onClick={() => navigate('/crm')}
          className="border border-border/70 shadow-xs hover:border-primary/50 hover:shadow-sm transition-all cursor-pointer group"
        >
          <CardHeader className="p-4 pb-2 flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground group-hover:text-primary transition-colors">
              Conversão de Leads
            </CardTitle>
            <div className="p-2 rounded-xl bg-emerald-500/10 text-emerald-700">
              <Target className="w-4 h-4" />
            </div>
          </CardHeader>
          <CardContent className="p-4 pt-1">
            <div className="text-2xl font-bold font-serif text-foreground">
              {renderValue(safeMetrics.leadConversionRate, '%')}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {safeMetrics.totalConvertidos ?? 0} convertido(s) de {safeMetrics.totalLeads ?? 0}{' '}
              contatos
            </p>
            <div className="pt-2 flex items-center text-[11px] font-medium text-primary gap-1 group-hover:translate-x-0.5 transition-transform">
              <span>Abrir CRM</span>
              <ArrowRight className="w-3 h-3" />
            </div>
          </CardContent>
        </Card>

        {/* Card 3: Retornos a 30-45 dias */}
        <Card
          onClick={() => navigate('/agenda')}
          className="border border-border/70 shadow-xs hover:border-primary/50 hover:shadow-sm transition-all cursor-pointer group"
        >
          <CardHeader className="p-4 pb-2 flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground group-hover:text-primary transition-colors">
              Retornos 30-45d
            </CardTitle>
            <div className="p-2 rounded-xl bg-blue-500/10 text-blue-700">
              <RotateCcw className="w-4 h-4" />
            </div>
          </CardHeader>
          <CardContent className="p-4 pt-1">
            <div className="text-2xl font-bold font-serif text-foreground">
              {renderValue(safeMetrics.retornos30a45DiasQtd)}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Pacientes na janela ideal de recall e retorno
            </p>
            <div className="pt-2 flex items-center text-[11px] font-medium text-primary gap-1 group-hover:translate-x-0.5 transition-transform">
              <span>Ver na Agenda</span>
              <ArrowRight className="w-3 h-3" />
            </div>
          </CardContent>
        </Card>

        {/* Card 4: Clube Ativo */}
        <Card
          onClick={() => navigate('/crm?filter=club')}
          className="border border-border/70 shadow-xs hover:border-primary/50 hover:shadow-sm transition-all cursor-pointer group"
        >
          <CardHeader className="p-4 pb-2 flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground group-hover:text-primary transition-colors">
              Clube Ativo
            </CardTitle>
            <div className="p-2 rounded-xl bg-purple-500/10 text-purple-700">
              <Crown className="w-4 h-4" />
            </div>
          </CardHeader>
          <CardContent className="p-4 pt-1">
            <div className="text-2xl font-bold font-serif text-foreground">
              {renderValue(safeMetrics.clubeAtivoQtd)}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Assinantes e membros ativos no Clube
            </p>
            <div className="pt-2 flex items-center text-[11px] font-medium text-primary gap-1 group-hover:translate-x-0.5 transition-transform">
              <span>Filtrar no CRM</span>
              <ArrowRight className="w-3 h-3" />
            </div>
          </CardContent>
        </Card>

        {/* Card 5: Taxa de Aceite da IA */}
        <Card className="border border-border/70 shadow-xs hover:border-border transition-colors">
          <CardHeader className="p-4 pb-2 flex flex-row items-center justify-between space-y-0">
            <div className="flex items-center gap-1.5">
              <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Taxa Aceite IA
              </CardTitle>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <HelpCircle className="w-3.5 h-3.5 text-muted-foreground cursor-pointer" />
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs text-xs">
                    {safeMetrics.iaAcceptanceTooltip ||
                      DEFAULT_EXECUTIVE_METRICS.iaAcceptanceTooltip}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
            <div className="p-2 rounded-xl bg-amber-500/10 text-amber-700">
              <Sparkles className="w-4 h-4" />
            </div>
          </CardHeader>
          <CardContent className="p-4 pt-1">
            <div className="text-2xl font-bold font-serif text-foreground">
              {renderValue(safeMetrics.iaAcceptanceRate, '%')}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Rascunhos aceitos da voz da secretária
            </p>
            <div className="pt-2 flex items-center text-[11px] text-muted-foreground gap-1">
              <span>Aguardando telemetria</span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* BLOCO EXPLICATIVO DE ESTRATÉGIA */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card className="border border-border/70 shadow-xs">
          <CardHeader className="p-4 pb-2">
            <CardTitle className="text-sm font-bold font-serif flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-primary" />
              Diretrizes de Conversão & Gestão
            </CardTitle>
            <CardDescription className="text-xs">
              Rotinas de rotatividade da recepção do Dr. Caio
            </CardDescription>
          </CardHeader>
          <CardContent className="p-4 pt-1 space-y-2 text-xs text-muted-foreground">
            <div className="flex items-start gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
              <p>
                <strong className="text-foreground">Fechamento do ciclo no dia:</strong> ao término
                dos atendimentos, valide com 1 clique se a consulta foi realizada ou faltou
                (no-show) para calibrar os lembretes de véspera.
              </p>
            </div>
            <div className="flex items-start gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
              <p>
                <strong className="text-foreground">Recall preventivo aos 30-45 dias:</strong>{' '}
                pacientes sem retorno marcado nessa janela recebem sugestão passiva para
                continuidade do plano de saúde.
              </p>
            </div>
            <div className="flex items-start gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
              <p>
                <strong className="text-foreground">Kill-Switch e Night Shield:</strong> nenhuma
                automação de disparo externo opera entre 21h e 07h, preservando a imagem médica.
              </p>
            </div>
          </CardContent>
        </Card>

        <Card className="border border-border/70 shadow-xs">
          <CardHeader className="p-4 pb-2">
            <CardTitle className="text-sm font-bold font-serif flex items-center gap-2">
              <Calendar className="w-4 h-4 text-primary" />
              Ações Rápidas do Gestor
            </CardTitle>
            <CardDescription className="text-xs">
              Atalhos para as principais operações clínicas
            </CardDescription>
          </CardHeader>
          <CardContent className="p-4 pt-1 grid grid-cols-1 sm:grid-cols-2 gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => navigate('/agenda')}
              className="h-10 text-xs justify-start gap-2"
            >
              <Calendar className="w-4 h-4 text-primary" />
              <span>Ver Agenda Oficial</span>
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => navigate('/financeiro')}
              className="h-10 text-xs justify-start gap-2"
            >
              <DollarSign className="w-4 h-4 text-emerald-600" />
              <span>Extrato Financeiro</span>
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => navigate('/crm')}
              className="h-10 text-xs justify-start gap-2"
            >
              <Target className="w-4 h-4 text-blue-600" />
              <span>Pipeline & Funil Vivo</span>
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => navigate('/fila')}
              className="h-10 text-xs justify-start gap-2"
            >
              <Sparkles className="w-4 h-4 text-amber-600" />
              <span>Fila do Dia</span>
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
