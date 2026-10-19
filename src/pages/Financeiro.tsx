import React, { useState, useEffect, useCallback, useMemo } from 'react'
import {
  DollarSign,
  TrendingUp,
  Receipt,
  Building2,
  FileText,
  Filter,
  Download,
  Plus,
  RefreshCw,
  Calendar,
  CreditCard,
  Banknote,
  Smartphone,
  Send,
  CheckCircle2,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { useCurrentAccount } from '@/hooks/use-current-account'
import { isNetworkError } from '@/lib/pocketbase/errors'
import {
  listPayments,
  fetchFinancialSummary,
  createPayment,
  FORMA_PAGAMENTO_LABELS,
  type PaymentSummary,
} from '@/services/payments_service'
import type { Payment, PaymentMethod } from '@/types/models'
import { formatBrazilianDate } from '@/lib/datetime'
import { toast } from 'sonner'

export function Financeiro() {
  const { currentAccount } = useCurrentAccount()
  const accountId = currentAccount?.id || ''

  const [loading, setLoading] = useState(true)
  const [payments, setPayments] = useState<Payment[]>([])
  const [summary, setSummary] = useState<PaymentSummary | null>(null)

  // Filtros
  const [selectedUnidade, setSelectedUnidade] = useState<string>('all')
  const [selectedForma, setSelectedForma] = useState<string>('all')
  const [searchTerm, setSearchTerm] = useState('')

  // Novo Lançamento Manual Modal
  const [newPaymentOpen, setNewPaymentOpen] = useState(false)
  const [newValor, setNewValor] = useState('500')
  const [newForma, setNewForma] = useState<PaymentMethod>('pix')
  const [newData, setNewData] = useState(() => new Date().toISOString().slice(0, 10))
  const [newUnidade, setNewUnidade] = useState('Carmo do Rio Claro')
  const [newObs, setNewObs] = useState('')
  const [savingNewPayment, setSavingNewPayment] = useState(false)

  // Consulta resiliente com timeout de 8s e fallback silencioso ("—", sem quebrar tela)
  const loadData = useCallback(async () => {
    if (!accountId) return
    setLoading(true)
    try {
      const [sumRes, payList] = await Promise.all([
        fetchFinancialSummary(accountId).catch((err) => {
          if (!isNetworkError(err)) console.warn('[Financeiro] Erro no sumário:', err)
          return null
        }),
        listPayments({
          accountId,
          forma: selectedForma as any,
          unidade: selectedUnidade,
        }).catch((err) => {
          if (!isNetworkError(err)) console.warn('[Financeiro] Erro na lista:', err)
          return [] as Payment[]
        }),
      ])

      setSummary(sumRes)
      setPayments(payList || [])
    } catch (err) {
      if (!isNetworkError(err)) {
        console.warn('[Financeiro] Erro geral ao carregar dados:', err)
      }
    } finally {
      setLoading(false)
    }
  }, [accountId, selectedUnidade, selectedForma])

  useEffect(() => {
    loadData()
  }, [loadData])

  // Filtragem local por texto (busca por paciente ou observações)
  const filteredPayments = useMemo(() => {
    if (!searchTerm.trim()) return payments
    const q = searchTerm.toLowerCase().trim()
    return payments.filter((p) => {
      const patientName =
        p.expand?.crm_contact_id?.contact_name || p.expand?.appointment_id?.patient_name || ''
      const obs = p.observacoes || ''
      return patientName.toLowerCase().includes(q) || obs.toLowerCase().includes(q)
    })
  }, [payments, searchTerm])

  const handleCreateManualPayment = async () => {
    if (!accountId) return
    const valorNum = parseFloat(newValor.replace(',', '.')) || 0
    if (valorNum <= 0) {
      toast.error('Informe um valor válido maior que zero.')
      return
    }

    setSavingNewPayment(true)
    try {
      await createPayment({
        account_id: accountId,
        valor: valorNum,
        forma_pagamento: newForma,
        data_pagamento: new Date(newData).toISOString(),
        unidade: newUnidade,
        observacoes: newObs || undefined,
      })
      toast.success('Lançamento financeiro registrado com sucesso!')
      setNewPaymentOpen(false)
      setNewObs('')
      loadData()
    } catch (err: any) {
      toast.error('Erro ao registrar lançamento: ' + (err?.message || ''))
    } finally {
      setSavingNewPayment(false)
    }
  }

  // Helper para formatar moeda com segurança
  const formatMoeda = (val?: number) => {
    if (val === undefined || isNaN(val)) return '—'
    return `R$ ${val.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  }

  // Ícone da forma de pagamento
  const renderFormaIcon = (forma: PaymentMethod) => {
    switch (forma) {
      case 'pix':
        return <Smartphone className="w-3.5 h-3.5 text-emerald-600" />
      case 'cartao':
        return <CreditCard className="w-3.5 h-3.5 text-blue-600" />
      case 'dinheiro':
        return <Banknote className="w-3.5 h-3.5 text-amber-600" />
      case 'transferencia':
        return <Send className="w-3.5 h-3.5 text-purple-600" />
      default:
        return <Receipt className="w-3.5 h-3.5 text-muted-foreground" />
    }
  }

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl sm:text-3xl font-serif font-bold tracking-tight text-foreground">
              Gestão Financeira
            </h1>
            <Badge
              variant="outline"
              className="bg-primary/5 text-primary border-primary/20 text-xs font-semibold"
            >
              Atendimentos & Receita
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            <strong>Financeiro — fluxo por atendimento da clínica do Dr. Caio.</strong> Acompanhe
            receita mensal, ticket médio por consulta, distribuição por unidade e orçamentos
            abertos.
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
            <span className="hidden sm:inline">Atualizar</span>
          </Button>

          <Button
            size="sm"
            onClick={() => setNewPaymentOpen(true)}
            className="gap-2 bg-primary text-primary-foreground shadow-sm ml-auto sm:ml-0"
          >
            <Plus className="w-4 h-4" />
            <span>Novo Lançamento</span>
          </Button>
        </div>
      </div>

      {/* 4 CARDS EXECUTIVOS NO TOPO */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Card 1: Receita do Mês */}
        <Card className="border border-border/70 shadow-xs hover:border-border transition-colors">
          <CardHeader className="p-4 pb-2 flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Receita do Mês
            </CardTitle>
            <div className="p-2 rounded-xl bg-emerald-500/10 text-emerald-700">
              <DollarSign className="w-4 h-4" />
            </div>
          </CardHeader>
          <CardContent className="p-4 pt-1">
            <div className="text-2xl font-bold font-serif text-foreground">
              {loading && !summary ? '—' : formatMoeda(summary?.receitaMesAtual)}
            </div>
            <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
              <TrendingUp className="w-3 h-3 text-emerald-600" />
              Mês anterior: {formatMoeda(summary?.receitaMesAnterior)}
            </p>
          </CardContent>
        </Card>

        {/* Card 2: Ticket Médio */}
        <Card className="border border-border/70 shadow-xs hover:border-border transition-colors">
          <CardHeader className="p-4 pb-2 flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Ticket Médio / Atendimento
            </CardTitle>
            <div className="p-2 rounded-xl bg-blue-500/10 text-blue-700">
              <Receipt className="w-4 h-4" />
            </div>
          </CardHeader>
          <CardContent className="p-4 pt-1">
            <div className="text-2xl font-bold font-serif text-foreground">
              {loading && !summary ? '—' : formatMoeda(summary?.ticketMedioMes)}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {summary?.totalAtendimentosMes || 0} atendimento(s) computado(s) neste mês
            </p>
          </CardContent>
        </Card>

        {/* Card 3: Por Unidade Líder */}
        <Card className="border border-border/70 shadow-xs hover:border-border transition-colors">
          <CardHeader className="p-4 pb-2 flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Unidades de Atendimento
            </CardTitle>
            <div className="p-2 rounded-xl bg-purple-500/10 text-purple-700">
              <Building2 className="w-4 h-4" />
            </div>
          </CardHeader>
          <CardContent className="p-4 pt-1">
            <div className="text-sm font-semibold text-foreground flex items-center justify-between">
              <span>Carmo do Rio Claro</span>
              <span>{formatMoeda(summary?.totalPorUnidade['Carmo do Rio Claro'] || 0)}</span>
            </div>
            <div className="text-xs text-muted-foreground flex items-center justify-between mt-1">
              <span>Alfenas & Monte Belo</span>
              <span>
                {formatMoeda(
                  (summary?.totalPorUnidade['Alfenas'] || 0) +
                    (summary?.totalPorUnidade['Monte Belo'] || 0),
                )}
              </span>
            </div>
          </CardContent>
        </Card>

        {/* Card 4: Orçamentos em Aberto */}
        <Card className="border border-border/70 shadow-xs hover:border-border transition-colors">
          <CardHeader className="p-4 pb-2 flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Orçamentos em Aberto
            </CardTitle>
            <div className="p-2 rounded-xl bg-amber-500/10 text-amber-700">
              <FileText className="w-4 h-4" />
            </div>
          </CardHeader>
          <CardContent className="p-4 pt-1">
            <div className="text-2xl font-bold font-serif text-foreground">
              {loading && !summary ? '—' : formatMoeda(summary?.orcamentosAbertosTotal)}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {summary?.orcamentosAbertosQtd || 0} proposta(s) no estágio Orçamento Enviado
            </p>
          </CardContent>
        </Card>
      </div>

      {/* DETALHAMENTO: POR FORMA DE PAGAMENTO E POR UNIDADE */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Distribuição por Forma de Pagamento */}
        <Card className="border border-border/70 shadow-xs">
          <CardHeader className="p-4 pb-3">
            <CardTitle className="text-sm font-bold font-serif flex items-center gap-2">
              <CreditCard className="w-4 h-4 text-primary" />
              Receita por Forma de Pagamento (Mês Atual)
            </CardTitle>
            <CardDescription className="text-xs">
              Pix, cartões de crédito/débito, dinheiro e transferências bancárias
            </CardDescription>
          </CardHeader>
          <CardContent className="p-4 pt-0 space-y-2.5">
            {(['pix', 'cartao', 'dinheiro', 'transferencia'] as PaymentMethod[]).map((forma) => {
              const val = summary?.totalPorForma[forma] || 0
              const totalMes = summary?.receitaMesAtual || 1
              const pct = totalMes > 0 ? Math.round((val / totalMes) * 100) : 0
              return (
                <div key={forma} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="flex items-center gap-1.5 font-medium text-foreground">
                      {renderFormaIcon(forma)}
                      {FORMA_PAGAMENTO_LABELS[forma]}
                    </span>
                    <span className="font-semibold text-foreground">
                      {formatMoeda(val)}{' '}
                      <span className="text-[11px] text-muted-foreground font-normal">
                        ({pct}%)
                      </span>
                    </span>
                  </div>
                  <div className="w-full bg-slate-100 rounded-full h-1.5 overflow-hidden">
                    <div
                      className="bg-primary h-1.5 rounded-full transition-all duration-300"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              )
            })}
          </CardContent>
        </Card>

        {/* Distribuição por Unidade */}
        <Card className="border border-border/70 shadow-xs">
          <CardHeader className="p-4 pb-3">
            <CardTitle className="text-sm font-bold font-serif flex items-center gap-2">
              <Building2 className="w-4 h-4 text-primary" />
              Receita por Unidade da Clínica
            </CardTitle>
            <CardDescription className="text-xs">
              Atendimentos em Carmo do Rio Claro, Alfenas, Monte Belo e Telemedicina Online
            </CardDescription>
          </CardHeader>
          <CardContent className="p-4 pt-0 space-y-2.5">
            {['Carmo do Rio Claro', 'Alfenas', 'Monte Belo', 'Online'].map((unidade) => {
              const val = summary?.totalPorUnidade[unidade] || 0
              const totalMes = summary?.receitaMesAtual || 1
              const pct = totalMes > 0 ? Math.round((val / totalMes) * 100) : 0
              return (
                <div key={unidade} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium text-foreground">{unidade}</span>
                    <span className="font-semibold text-foreground">
                      {formatMoeda(val)}{' '}
                      <span className="text-[11px] text-muted-foreground font-normal">
                        ({pct}%)
                      </span>
                    </span>
                  </div>
                  <div className="w-full bg-slate-100 rounded-full h-1.5 overflow-hidden">
                    <div
                      className="bg-emerald-600 h-1.5 rounded-full transition-all duration-300"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              )
            })}
          </CardContent>
        </Card>
      </div>

      {/* TABELA DE ATENDIMENTOS E LANÇAMENTOS FINANCEIROS */}
      <Card className="border border-border/70 shadow-xs">
        <CardHeader className="p-4 pb-3 border-b border-border/60">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div>
              <CardTitle className="text-sm font-bold font-serif flex items-center gap-2">
                <Receipt className="w-4 h-4 text-primary" />
                Histórico de Lançamentos Financeiros
              </CardTitle>
              <CardDescription className="text-xs">
                Valores recebidos por atendimento e fechamento de ciclo
              </CardDescription>
            </div>

            {/* Filtros da Tabela */}
            <div className="flex items-center gap-2 w-full sm:w-auto flex-wrap">
              <Input
                placeholder="Buscar paciente / obs..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="h-8 text-xs w-full sm:w-48"
              />

              <Select value={selectedUnidade} onValueChange={setSelectedUnidade}>
                <SelectTrigger className="h-8 text-xs w-36">
                  <SelectValue placeholder="Unidade" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas Unidades</SelectItem>
                  <SelectItem value="Carmo do Rio Claro">Carmo do Rio Claro</SelectItem>
                  <SelectItem value="Alfenas">Alfenas</SelectItem>
                  <SelectItem value="Monte Belo">Monte Belo</SelectItem>
                  <SelectItem value="Online">Online</SelectItem>
                </SelectContent>
              </Select>

              <Select value={selectedForma} onValueChange={setSelectedForma}>
                <SelectTrigger className="h-8 text-xs w-32">
                  <SelectValue placeholder="Forma" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas Formas</SelectItem>
                  <SelectItem value="pix">Pix</SelectItem>
                  <SelectItem value="cartao">Cartão</SelectItem>
                  <SelectItem value="dinheiro">Dinheiro</SelectItem>
                  <SelectItem value="transferencia">Transferência</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>

        <CardContent className="p-0">
          {loading ? (
            <div className="p-8 text-center text-xs text-muted-foreground">
              Carregando lançamentos financeiros...
            </div>
          ) : filteredPayments.length === 0 ? (
            <div className="p-12 text-center space-y-2">
              <p className="text-sm font-medium text-foreground">Nenhum lançamento encontrado</p>
              <p className="text-xs text-muted-foreground max-w-sm mx-auto">
                Realize o fechamento de consultas na Agenda para registrar recebimentos
                automaticamente, ou clique em &quot;Novo Lançamento&quot;.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-border/60 text-xs">
              {filteredPayments.map((p) => {
                const patientName =
                  p.expand?.crm_contact_id?.contact_name ||
                  p.expand?.appointment_id?.patient_name ||
                  'Paciente da Clínica'
                return (
                  <div
                    key={p.id}
                    className="p-3.5 flex items-center justify-between hover:bg-slate-50/70 transition-colors gap-3"
                  >
                    <div className="min-w-0 flex-1 space-y-0.5">
                      <div className="flex items-center gap-2 font-semibold text-foreground">
                        <span className="truncate">{patientName}</span>
                        <Badge
                          variant="outline"
                          className="text-[10px] bg-white gap-1 py-0 h-4 font-normal"
                        >
                          {renderFormaIcon(p.forma_pagamento)}
                          {FORMA_PAGAMENTO_LABELS[p.forma_pagamento] || p.forma_pagamento}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-3 text-muted-foreground text-[11px] flex-wrap">
                        <span className="flex items-center gap-1">
                          <Calendar className="w-3 h-3" />
                          {p.data_pagamento ? formatBrazilianDate(p.data_pagamento) : '—'}
                        </span>
                        <span>•</span>
                        <span>{p.unidade || 'Carmo do Rio Claro'}</span>
                        {p.observacoes && (
                          <>
                            <span>•</span>
                            <span className="truncate italic text-foreground/80">
                              {p.observacoes}
                            </span>
                          </>
                        )}
                      </div>
                    </div>

                    <div className="text-right shrink-0">
                      <span className="text-sm font-bold font-serif text-emerald-900 block">
                        {formatMoeda(p.valor)}
                      </span>
                      <span className="text-[10px] text-muted-foreground flex items-center justify-end gap-1">
                        <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                        Confirmado
                      </span>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* MODAL: NOVO LANÇAMENTO MANUAL */}
      <Dialog open={newPaymentOpen} onOpenChange={setNewPaymentOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="font-serif">Novo Lançamento Financeiro</DialogTitle>
            <DialogDescription className="text-xs">
              Lance manualmente uma receita ou atendimento avulso na clínica.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2 text-xs">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="manual-val" className="text-xs font-semibold">
                  Valor (R$)
                </Label>
                <Input
                  id="manual-val"
                  value={newValor}
                  onChange={(e) => setNewValor(e.target.value)}
                  placeholder="500,00"
                  className="h-9 text-xs"
                />
              </div>

              <div className="space-y-1">
                <Label htmlFor="manual-data" className="text-xs font-semibold">
                  Data do Pagamento
                </Label>
                <Input
                  id="manual-data"
                  type="date"
                  value={newData}
                  onChange={(e) => setNewData(e.target.value)}
                  className="h-9 text-xs"
                />
              </div>
            </div>

            <div className="space-y-1">
              <Label className="text-xs font-semibold">Unidade de Atendimento</Label>
              <Select value={newUnidade} onValueChange={setNewUnidade}>
                <SelectTrigger className="h-9 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Carmo do Rio Claro">Carmo do Rio Claro</SelectItem>
                  <SelectItem value="Alfenas">Alfenas</SelectItem>
                  <SelectItem value="Monte Belo">Monte Belo</SelectItem>
                  <SelectItem value="Online">Online</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Forma de Pagamento</Label>
              <RadioGroup
                value={newForma}
                onValueChange={(v) => setNewForma(v as PaymentMethod)}
                className="grid grid-cols-2 gap-2"
              >
                <div className="flex items-center space-x-2 border rounded-lg p-2">
                  <RadioGroupItem value="pix" id="mf-pix" />
                  <Label htmlFor="mf-pix" className="text-xs cursor-pointer">
                    Pix
                  </Label>
                </div>
                <div className="flex items-center space-x-2 border rounded-lg p-2">
                  <RadioGroupItem value="cartao" id="mf-cartao" />
                  <Label htmlFor="mf-cartao" className="text-xs cursor-pointer">
                    Cartão
                  </Label>
                </div>
                <div className="flex items-center space-x-2 border rounded-lg p-2">
                  <RadioGroupItem value="dinheiro" id="mf-dinheiro" />
                  <Label htmlFor="mf-dinheiro" className="text-xs cursor-pointer">
                    Dinheiro
                  </Label>
                </div>
                <div className="flex items-center space-x-2 border rounded-lg p-2">
                  <RadioGroupItem value="transferencia" id="mf-transf" />
                  <Label htmlFor="mf-transf" className="text-xs cursor-pointer">
                    Transferência
                  </Label>
                </div>
              </RadioGroup>
            </div>

            <div className="space-y-1">
              <Label htmlFor="manual-obs" className="text-xs font-semibold">
                Descrição / Paciente / Observações
              </Label>
              <Input
                id="manual-obs"
                value={newObs}
                onChange={(e) => setNewObs(e.target.value)}
                placeholder="Ex: Consulta Dr. Caio - Retorno com bioimpedância"
                className="h-9 text-xs"
              />
            </div>
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setNewPaymentOpen(false)}
              disabled={savingNewPayment}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={handleCreateManualPayment}
              disabled={savingNewPayment}
            >
              {savingNewPayment ? 'Salvando...' : 'Salvar Lançamento'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
