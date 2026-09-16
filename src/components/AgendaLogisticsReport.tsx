import React, { useMemo, useState } from 'react'
import {
  CalendarDays,
  MapPin,
  CheckCircle2,
  AlertCircle,
  Clock,
  Phone,
  Sparkles,
  MessageSquare,
  ShieldCheck,
  Building,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Appointment } from '@/types/models'
import { formatTimeSaoPaulo, formatBrazilianDate } from '@/lib/datetime'

interface AgendaLogisticsReportProps {
  appointments: Appointment[]
  onOpenConversation?: (appointment: Appointment) => void
  onRefreshSync?: () => void
  syncing?: boolean
}

const CITY_LOCATIONS_MAP: Record<string, string> = {
  'Carmo do Rio Claro': 'Climed Carmo do Rio Claro',
  Alfenas: 'Instituto Harmoniza Alfenas',
  'Monte Belo': 'Monte Belo',
  Online: 'Atendimento Online',
}

export function isPatientTriggered(a: Appointment): boolean {
  const rec = a as any
  if (rec.patient_triggered) return true
  if (rec.confirmation_sent) return true
  if (rec.day_reminder_sent) return true
  if (rec.recall_sent) return true
  if (rec.last_care_message_type && rec.last_care_message_type !== '') return true
  if (rec.last_care_sent_at && rec.last_care_sent_at !== '') return true
  // Campos oficiais da migration 0097 / models.ts
  if (a.confirmation_sent_at && a.confirmation_sent_at !== '') return true
  if (a.reminder_day_sent_at && a.reminder_day_sent_at !== '') return true
  if (a.followup_sent_at && a.followup_sent_at !== '') return true
  if (a.task_created_at && a.task_created_at !== '') return true
  return false
}

export function AgendaLogisticsReport({
  appointments,
  onOpenConversation,
  onRefreshSync,
  syncing,
}: AgendaLogisticsReportProps) {
  const [filterCity, setFilterCity] = useState<string>('all')
  const [filterStatus, setFilterStatus] = useState<string>('all')
  const [filterType, setFilterType] = useState<string>('all')
  const [filterCare, setFilterCare] = useState<'all' | 'triggered' | 'not_triggered'>('all')
  const [search, setSearch] = useState<string>('')

  // Janela de últimos 2 meses: de 60 dias atrás até agora
  const now = useMemo(() => new Date(), [])
  const twoMonthsAgo = useMemo(() => new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000), [now])

  // Filtrar apenas agendamentos dos últimos 2 meses (historico recente até hoje)
  const last2MonthsAppointments = useMemo(() => {
    return appointments.filter((a) => {
      const d = new Date(a.starts_at)
      return d >= twoMonthsAgo && d <= now
    })
  }, [appointments, twoMonthsAgo, now])

  // Próximos pacientes a atender (futuros ordenados por data)
  const upcomingAppointments = useMemo(() => {
    return appointments
      .filter((a) => {
        const d = new Date(a.starts_at)
        return d >= now && a.status !== 'cancelado'
      })
      .sort((a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime())
  }, [appointments, now])

  // Estatísticas dos últimos 2 meses
  const stats = useMemo(() => {
    const total = last2MonthsAppointments.length
    let confirmados = 0
    let agendados = 0
    let realizados = 0
    let faltas = 0
    let cancelados = 0

    let acionados = 0
    let naoAcionados = 0

    const porCidade: Record<string, number> = {
      'Climed Carmo do Rio Claro': 0,
      'Instituto Harmoniza Alfenas': 0,
      'Monte Belo': 0,
      'Atendimento Online': 0,
      Outros: 0,
    }

    const porTipo: Record<string, number> = {
      Consulta: 0,
      Retorno: 0,
      Consultoria: 0,
      Outros: 0,
    }

    last2MonthsAppointments.forEach((a) => {
      // Status
      if (a.status === 'confirmado') confirmados++
      else if (a.status === 'agendado') agendados++
      else if (a.status === 'realizado') realizados++
      else if (a.status === 'faltou') faltas++
      else if (a.status === 'cancelado') cancelados++

      // Tipo (Consulta, Retorno, Consultoria)
      const tRaw = (a.appointment_type || '').toLowerCase()
      if (tRaw.includes('retorno') || tRaw.includes('reavalia')) {
        porTipo.Retorno = (porTipo.Retorno || 0) + 1
      } else if (tRaw.includes('consultoria')) {
        porTipo.Consultoria = (porTipo.Consultoria || 0) + 1
      } else if (tRaw.includes('consulta') || tRaw.includes('primeira') || !tRaw) {
        porTipo.Consulta = (porTipo.Consulta || 0) + 1
      } else {
        porTipo.Outros = (porTipo.Outros || 0) + 1
      }

      // Acionamento de cuidado
      if (isPatientTriggered(a)) {
        acionados++
      } else {
        naoAcionados++
      }

      // Cidades
      const locKey =
        CITY_LOCATIONS_MAP[a.city] ||
        (a.city === 'Carmo do Rio Claro'
          ? 'Climed Carmo do Rio Claro'
          : a.city === 'Alfenas'
            ? 'Instituto Harmoniza Alfenas'
            : a.city === 'Monte Belo'
              ? 'Monte Belo'
              : a.city === 'Online'
                ? 'Atendimento Online'
                : 'Outros')

      porCidade[locKey] = (porCidade[locKey] || 0) + 1
    })

    return {
      total,
      confirmados,
      agendados,
      realizados,
      faltas,
      cancelados,
      acionados,
      naoAcionados,
      taxaAcionamento: total > 0 ? Math.round((acionados / total) * 100) : 0,
      porCidade,
      porTipo,
    }
  }, [last2MonthsAppointments])

  // Filtragem dos próximos pacientes
  const filteredUpcoming = useMemo(() => {
    return upcomingAppointments.filter((a) => {
      if (filterCity !== 'all' && a.city !== filterCity) return false
      if (filterStatus !== 'all' && a.status !== filterStatus) return false

      if (filterType !== 'all') {
        const tLower = (a.appointment_type || '').toLowerCase()
        if (
          filterType === 'Consulta' &&
          !tLower.includes('consulta') &&
          !tLower.includes('primeira') &&
          tLower !== ''
        )
          return false
        if (filterType === 'Retorno' && !tLower.includes('retorno')) return false
        if (filterType === 'Consultoria' && !tLower.includes('consultoria')) return false
      }

      const triggered = isPatientTriggered(a)
      if (filterCare === 'triggered' && !triggered) return false
      if (filterCare === 'not_triggered' && triggered) return false

      if (search.trim()) {
        const q = search.toLowerCase()
        const name = (a.patient_name || '').toLowerCase()
        const phone = (a.patient_phone || '').toLowerCase()
        const doc = (a.doctor || '').toLowerCase()
        if (!name.includes(q) && !phone.includes(q) && !doc.includes(q)) {
          return false
        }
      }

      return true
    })
  }, [upcomingAppointments, filterCity, filterStatus, filterCare, search])

  return (
    <div className="space-y-6">
      {/* Banner de cabeçalho do painel */}
      <div className="rounded-xl border border-emerald-500/20 bg-gradient-to-r from-emerald-500/10 via-teal-500/5 to-transparent p-5">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <CalendarDays className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
              <h2 className="text-lg font-semibold text-foreground">
                Logística & Cuidado dos Últimos 2 Meses
              </h2>
              <Badge
                variant="outline"
                className="text-xs bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/20"
              >
                Dr. Caio
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground">
              Análise dos atendimentos por localidade, status e acompanhamento de pacientes
              acionados pelas mensagens de cuidado (confirmações, lembretes de véspera e recall).
            </p>
          </div>

          <div className="flex items-center gap-2">
            {onRefreshSync && (
              <Button
                variant="outline"
                size="sm"
                onClick={onRefreshSync}
                disabled={syncing}
                className="gap-2"
              >
                <Sparkles className={`h-4 w-4 ${syncing ? 'animate-spin' : ''}`} />
                {syncing ? 'Sincronizando...' : 'Atualizar Dados da Agenda'}
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Cards de Métricas Principais: Total, Consultas, Retornos, Consultorias */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="bg-card/50 backdrop-blur-sm border-border/60">
          <CardHeader className="pb-2">
            <CardDescription className="text-xs">Consultas</CardDescription>
            <CardTitle className="text-2xl font-bold text-blue-600 dark:text-blue-400 flex items-center justify-between">
              <span>{stats.porTipo.Consulta}</span>
              <CalendarDays className="h-4 w-4 text-blue-500" />
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground pt-0">
            {stats.total > 0 ? Math.round((stats.porTipo.Consulta / stats.total) * 100) : 0}% do
            total
          </CardContent>
        </Card>

        <Card className="bg-card/50 backdrop-blur-sm border-border/60">
          <CardHeader className="pb-2">
            <CardDescription className="text-xs">Retornos</CardDescription>
            <CardTitle className="text-2xl font-bold text-amber-600 dark:text-amber-400 flex items-center justify-between">
              <span>{stats.porTipo.Retorno}</span>
              <Clock className="h-4 w-4 text-amber-500" />
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground pt-0">
            Reavaliações / retornos periódicos
          </CardContent>
        </Card>

        <Card className="bg-card/50 backdrop-blur-sm border-border/60">
          <CardHeader className="pb-2">
            <CardDescription className="text-xs">Consultorias</CardDescription>
            <CardTitle className="text-2xl font-bold text-purple-600 dark:text-purple-400 flex items-center justify-between">
              <span>{stats.porTipo.Consultoria}</span>
              <Sparkles className="h-4 w-4 text-purple-500" />
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground pt-0">
            Consultorias e acompanhamentos
          </CardContent>
        </Card>

        <Card className="bg-card/50 backdrop-blur-sm border-border/60">
          <CardHeader className="pb-2">
            <CardDescription className="text-xs">Taxa de Cuidado Ativo</CardDescription>
            <CardTitle className="text-2xl font-bold text-emerald-600 dark:text-emerald-400 flex items-center justify-between">
              <span>{stats.taxaAcionamento}%</span>
              <ShieldCheck className="h-4 w-4 text-emerald-500" />
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground pt-0">
            {stats.acionados} acionados / {stats.naoAcionados} pendentes
          </CardContent>
        </Card>
      </div>

      {/* Cards de Métricas Secundárias */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="bg-card/50 backdrop-blur-sm border-border/60">
          <CardHeader className="pb-2">
            <CardDescription className="text-xs">Consultas (Últimos 2 meses)</CardDescription>
            <CardTitle className="text-2xl font-bold flex items-center justify-between">
              <span>{stats.total}</span>
              <CalendarDays className="h-4 w-4 text-muted-foreground" />
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground pt-0">
            {stats.confirmados + stats.realizados} realizadas/confirmadas
          </CardContent>
        </Card>

        <Card className="bg-card/50 backdrop-blur-sm border-border/60">
          <CardHeader className="pb-2">
            <CardDescription className="text-xs">Pacientes Acionados</CardDescription>
            <CardTitle className="text-2xl font-bold text-emerald-600 dark:text-emerald-400 flex items-center justify-between">
              <span>{stats.acionados}</span>
              <ShieldCheck className="h-4 w-4 text-emerald-500" />
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground pt-0">
            {stats.taxaAcionamento}% com lembrete/recall enviado
          </CardContent>
        </Card>

        <Card className="bg-card/50 backdrop-blur-sm border-border/60">
          <CardHeader className="pb-2">
            <CardDescription className="text-xs">Não Acionados (Atenção)</CardDescription>
            <CardTitle className="text-2xl font-bold text-amber-600 dark:text-amber-400 flex items-center justify-between">
              <span>{stats.naoAcionados}</span>
              <AlertCircle className="h-4 w-4 text-amber-500" />
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground pt-0">
            Sem régua de cuidado disparada
          </CardContent>
        </Card>

        <Card className="bg-card/50 backdrop-blur-sm border-border/60">
          <CardHeader className="pb-2">
            <CardDescription className="text-xs">Próximos a Atender</CardDescription>
            <CardTitle className="text-2xl font-bold text-blue-600 dark:text-blue-400 flex items-center justify-between">
              <span>{upcomingAppointments.length}</span>
              <Clock className="h-4 w-4 text-blue-500" />
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground pt-0">
            Agendamentos futuros na fila
          </CardContent>
        </Card>
      </div>

      {/* Grid: Logística por Localidade & Distribuição por Status */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Logística por Cidade / Local */}
        <Card className="border-border/60">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <MapPin className="h-4 w-4 text-primary" />
              Distribuição por Localidade (2 meses)
            </CardTitle>
            <CardDescription className="text-xs">
              Locais de atendimento do Dr. Caio na região e remoto
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {Object.entries(stats.porCidade).map(([local, count]) => {
              const pct = stats.total > 0 ? Math.round((count / stats.total) * 100) : 0
              return (
                <div key={local} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium flex items-center gap-1.5">
                      <Building className="h-3.5 w-3.5 text-muted-foreground" />
                      {local}
                    </span>
                    <span className="text-muted-foreground">
                      <strong>{count}</strong> ({pct}%)
                    </span>
                  </div>
                  <div className="h-2 w-full rounded-full bg-secondary overflow-hidden">
                    <div
                      className="h-full bg-primary rounded-full transition-all duration-500"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              )
            })}
          </CardContent>
        </Card>

        {/* Status das Consultas */}
        <Card className="border-border/60">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-primary" />
              Status das Consultas (2 meses)
            </CardTitle>
            <CardDescription className="text-xs">
              Adesão, comparecimento e faltas no período
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-3">
              <div className="p-3 rounded-lg border bg-muted/30">
                <span className="text-xs text-muted-foreground">Confirmadas / Realizadas</span>
                <p className="text-xl font-bold text-emerald-600 mt-1">
                  {stats.confirmados + stats.realizados}
                </p>
                <span className="text-[10px] text-muted-foreground">
                  {stats.confirmados} confirmadas, {stats.realizados} realizadas
                </span>
              </div>

              <div className="p-3 rounded-lg border bg-muted/30">
                <span className="text-xs text-muted-foreground">Agendadas (Aguardando)</span>
                <p className="text-xl font-bold text-blue-600 mt-1">{stats.agendados}</p>
                <span className="text-[10px] text-muted-foreground">
                  Na expectativa de confirmação
                </span>
              </div>

              <div className="p-3 rounded-lg border bg-muted/30">
                <span className="text-xs text-muted-foreground">Faltas / Ausências</span>
                <p className="text-xl font-bold text-amber-600 mt-1">{stats.faltas}</p>
                <span className="text-[10px] text-muted-foreground">
                  Pacientes para resgate/recall
                </span>
              </div>

              <div className="p-3 rounded-lg border bg-muted/30">
                <span className="text-xs text-muted-foreground">Cancelamentos</span>
                <p className="text-xl font-bold text-rose-600 mt-1">{stats.cancelados}</p>
                <span className="text-[10px] text-muted-foreground">Desmarcados</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Lista: Próximos Pacientes a Atender com Indicador de Cuidado */}
      <Card className="border-border/60">
        <CardHeader className="pb-4">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <Clock className="h-4 w-4 text-primary" />
                Próximos Pacientes a Atender (Priorização de Atendimento)
              </CardTitle>
              <CardDescription className="text-xs">
                Ordem cronológica com status de acionamento pelas mensagens de cuidado
              </CardDescription>
            </div>

            {/* Controles de Filtro */}
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative min-w-[160px]">
                <Input
                  placeholder="Buscar paciente..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="h-8 text-xs"
                />
              </div>

              <Select value={filterType} onValueChange={setFilterType}>
                <SelectTrigger className="h-8 text-xs w-[130px]">
                  <SelectValue placeholder="Tipo" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos os tipos</SelectItem>
                  <SelectItem value="Consulta">Consulta</SelectItem>
                  <SelectItem value="Retorno">Retorno</SelectItem>
                  <SelectItem value="Consultoria">Consultoria</SelectItem>
                </SelectContent>
              </Select>

              <Select value={filterCity} onValueChange={setFilterCity}>
                <SelectTrigger className="h-8 text-xs w-[140px]">
                  <SelectValue placeholder="Localidade" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos os locais</SelectItem>
                  <SelectItem value="Carmo do Rio Claro">Carmo do Rio Claro</SelectItem>
                  <SelectItem value="Alfenas">Alfenas</SelectItem>
                  <SelectItem value="Monte Belo">Monte Belo</SelectItem>
                  <SelectItem value="Online">Online</SelectItem>
                </SelectContent>
              </Select>

              <Select
                value={filterCare}
                onValueChange={(v: 'all' | 'triggered' | 'not_triggered') => setFilterCare(v)}
              >
                <SelectTrigger className="h-8 text-xs w-[150px]">
                  <SelectValue placeholder="Status Cuidado" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos (Cuidado)</SelectItem>
                  <SelectItem value="triggered">✅ Acionados</SelectItem>
                  <SelectItem value="not_triggered">⬜ Não Acionados</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {filteredUpcoming.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">
              Nenhum agendamento futuro encontrado com os filtros selecionados.
            </div>
          ) : (
            <div className="divide-y divide-border/50">
              {filteredUpcoming.map((item) => {
                const triggered = isPatientTriggered(item)
                const locationLabel = CITY_LOCATIONS_MAP[item.city] || item.location || item.city

                return (
                  <div
                    key={item.id}
                    className="p-4 hover:bg-muted/40 transition-colors flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
                  >
                    <div className="flex items-start gap-3">
                      <div className="h-10 w-10 rounded-full bg-primary/10 text-primary flex items-center justify-center font-semibold text-sm shrink-0">
                        {item.patient_name ? item.patient_name.charAt(0).toUpperCase() : 'P'}
                      </div>

                      <div className="space-y-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium text-sm text-foreground">
                            {item.patient_name || 'Paciente sem nome'}
                          </span>

                          {/* Indicador de acionado pelas mensagens de cuidado */}
                          {triggered ? (
                            <Badge
                              variant="outline"
                              className="text-[11px] bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30 gap-1 font-normal"
                            >
                              <CheckCircle2 className="h-3 w-3 text-emerald-600 dark:text-emerald-400" />
                              ✅ Acionado (Cuidado Ativo)
                            </Badge>
                          ) : (
                            <Badge
                              variant="outline"
                              className="text-[11px] bg-muted/60 text-muted-foreground border-border gap-1 font-normal"
                            >
                              ⬜ Não acionado
                            </Badge>
                          )}

                          <Badge variant="secondary" className="text-[11px] capitalize font-normal">
                            {item.status}
                          </Badge>
                        </div>

                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                          <span className="flex items-center gap-1 font-medium text-foreground/80">
                            <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                            {formatBrazilianDate(item.starts_at)} às{' '}
                            {formatTimeSaoPaulo(item.starts_at)}
                          </span>

                          <span className="flex items-center gap-1">
                            <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
                            {locationLabel}
                          </span>

                          {item.patient_phone && (
                            <span className="flex items-center gap-1">
                              <Phone className="h-3.5 w-3.5 text-muted-foreground" />
                              {item.patient_phone}
                            </span>
                          )}

                          {item.appointment_type && (
                            <Badge
                              variant="secondary"
                              className={
                                item.appointment_type.toLowerCase().includes('retorno')
                                  ? 'bg-amber-100 text-amber-800 border-amber-300 text-[10px] py-0'
                                  : item.appointment_type.toLowerCase().includes('consultoria')
                                    ? 'bg-purple-100 text-purple-800 border-purple-300 text-[10px] py-0'
                                    : 'bg-blue-100 text-blue-800 border-blue-300 text-[10px] py-0'
                              }
                            >
                              {item.appointment_type}
                            </Badge>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 self-end sm:self-center">
                      {onOpenConversation && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => onOpenConversation(item)}
                          className="h-8 text-xs gap-1.5"
                        >
                          <MessageSquare className="h-3.5 w-3.5" />
                          Conversa
                        </Button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
export default AgendaLogisticsReport
