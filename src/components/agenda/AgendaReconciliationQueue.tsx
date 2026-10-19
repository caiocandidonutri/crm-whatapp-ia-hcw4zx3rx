import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  CheckCheck,
  CheckCircle2,
  ClipboardCheck,
  MessageSquare,
  RefreshCw,
  ShieldAlert,
} from 'lucide-react'
import { toast } from 'sonner'
import pb from '@/lib/pocketbase/client'
import { safePbFullList, safePbQuery } from '@/lib/pocketbase/resilient'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { useCurrentAccount } from '@/hooks/use-current-account'
import { useAutomationsStatus } from '@/hooks/use-automations-status'
import type { Appointment } from '@/types/models'
import { updateAppointment } from '@/services/appointments'
import {
  CLINIC_TIMEZONE,
  formatBrazilianDate,
  formatTimeSaoPaulo,
  getDayDiffFromTodaySaoPaulo,
  parseToDate,
} from '@/lib/datetime'

/** Janela útil de evidência: mensagens trocadas de D-1 até D+1 da consulta. */
const EVIDENCE_WINDOW_DAYS = 1
const MAX_DETAIL_APPOINTMENTS = 60

interface ReconcileItem {
  appointment: Appointment
  /** true quando há ao menos uma mensagem com o paciente dentro da janela D±1 */
  hasDplusMinusEvidence: boolean
  /** nº de mensagens trocadas com o paciente na janela D±1 (metadado; LGPD: sem conteúdo) */
  evidenceCount: number
  /** data da última mensagem trocada na janela */
  lastEvidenceAt: Date | null
}

/** Trata data PocketBase ("2025-01-02 03:04:05.000Z") e timestamp unix (segundos/ms). */
function toSafeDate(value: unknown): Date | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'number') {
    // timestamp unix em segundos ou milissegundos
    const ms = value > 1e12 ? value : value * 1000
    const d = new Date(ms)
    return isNaN(d.getTime()) ? null : d
  }
  if (typeof value === 'string') {
    const d = parseToDate(value)
    return d && !isNaN(d.getTime()) ? d : null
  }
  return null
}

/**
 * Fila de Reconciliação da Agenda (Fase 2).
 *
 * Mostra agendamentos JÁ PASSADOS ainda com status "confirmado" e apresenta a
 * EVIDÊNCIA de comunicação com a paciente nos dias D±1 (contagem de mensagens
 * trocadas — apenas metadados, LGPD: nenhum conteúdo sai do CRM).
 *
 * NADA é automático: a confirmação de "realizado" é sempre um clique humano,
 * individual ou em lote de 1 clique com os itens que a própria secretária
 * selecionar. Nenhum disparo, nenhum push para agenda externa.
 */
export function AgendaReconciliationQueue() {
  const { accountId } = useCurrentAccount()
  const { paused: automationsPaused } = useAutomationsStatus()

  const [loading, setLoading] = useState(true)
  const [appointments, setAppointments] = useState<Appointment[]>([])
  const [evidenceMap, setEvidenceMap] = useState<Record<string, ReconcileItem['evidenceCount']>>({})
  const [lastEvidenceMap, setLastEvidenceMap] = useState<Record<string, Date | null>>({})
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [confirming, setConfirming] = useState<Set<string>>(new Set())
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [batchConfirmOpen, setBatchConfirmOpen] = useState(false)

  const load = useCallback(async () => {
    if (!accountId) return
    setLoading(true)
    try {
      // Janela: -60 dias a hoje (consulta passada). Acesso direto à coleção,
      // sem depender do serviço de sync da agenda externa.
      const since = new Date(Date.now() - 60 * 86400_000).toISOString()
      const nowIso = new Date().toISOString()

      const res = await safePbFullList<Appointment>({
        collection: 'appointments',
        filter: `account_id = "${accountId}" && starts_at < "${nowIso}" && starts_at > "${since}" && status = "confirmado"`,
        sort: '-starts_at',
        perPage: 200,
        label: 'reconciliation:appointments',
      })

      const items = Array.isArray(res) ? res : []
      setAppointments(items)

      // Evidência: mensagens trocadas com a paciente nos dias D±1 de cada consulta
      // (consulta em si). Apenas CONTAGEM/timestamp — LGPD: nenhum conteúdo sai.
      const counts: Record<string, number> = {}
      const lasts: Record<string, Date | null> = {}

      await Promise.all(
        items.slice(0, MAX_DETAIL_APPOINTMENTS).map(async (app) => {
          const start = toSafeDate(app.starts_at)
          if (!start) return
          const digits = String(app.patient_phone || '').replace(/\D/g, '')
          const suffix = digits.slice(-8)
          if (!suffix || suffix.length < 8) {
            counts[app.id] = 0
            lasts[app.id] = null
            return
          }

          const d0 = new Date(start.getTime() - EVIDENCE_WINDOW_DAYS * 86400_000)
          const d1 = new Date(start.getTime() + (EVIDENCE_WINDOW_DAYS + 1) * 86400_000)

          try {
            // Consulta resiliente com safePbQuery (catch individual, timeout, retry 429)
            const msgs = await safePbQuery(
              () =>
                pb.collection('whatsapp_messages').getList(1, 200, {
                  filter: `remote_jid ~ "${suffix}" && timestamp >= ${Math.floor(d0.getTime() / 1000)} && timestamp <= ${Math.floor(d1.getTime() / 1000)}`,
                  fields: 'id,timestamp,from_me',
                  sort: '-timestamp',
                  requestKey: null,
                }),
              {
                label: `evidence:${app.id}`,
                fallback: {
                  page: 1,
                  perPage: 200,
                  totalItems: 0,
                  totalPages: 0,
                  items: [],
                },
                timeoutMs: 5000,
                maxRetries: 1,
              },
            )
            const itemsList = Array.isArray(msgs?.items) ? msgs.items : []
            counts[app.id] = itemsList.length
            lasts[app.id] =
              itemsList.length > 0 ? (toSafeDate(itemsList[0]?.timestamp) ?? null) : null
          } catch {
            // Qualquer falha degrada a evidência a zero sem subir ao ErrorBoundary
            counts[app.id] = 0
            lasts[app.id] = null
          }
        }),
      )

      setEvidenceMap(counts)
      setLastEvidenceMap(lasts)
    } catch {
      toast.error('Erro ao carregar fila de reconciliação')
      setAppointments([])
    } finally {
      setLoading(false)
    }
  }, [accountId])

  useEffect(() => {
    load()
  }, [load])

  const items: ReconcileItem[] = useMemo(
    () =>
      appointments.map((app) => ({
        appointment: app,
        hasDplusMinusEvidence: (evidenceMap[app.id] || 0) > 0,
        evidenceCount: evidenceMap[app.id] || 0,
        lastEvidenceAt: lastEvidenceMap[app.id] ?? null,
      })),
    [appointments, evidenceMap, lastEvidenceMap],
  )

  const withEvidence = items.filter((i) => i.hasDplusMinusEvidence)
  const withoutEvidence = items.filter((i) => !i.hasDplusMinusEvidence)
  const selectedCount = selected.size

  const toggleSelected = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const confirmOne = async (item: ReconcileItem) => {
    setConfirming((prev) => new Set(prev).add(item.appointment.id))
    try {
      await updateAppointment(item.appointment.id, { status: 'realizado' })
      setAppointments((prev) => prev.filter((a) => a.id !== item.appointment.id))
      setSelected((prev) => {
        const next = new Set(prev)
        next.delete(item.appointment.id)
        return next
      })
      toast.success('Atendimento marcado como realizado')
    } catch {
      toast.error('Erro ao confirmar agendamento')
    } finally {
      setConfirming((prev) => {
        const next = new Set(prev)
        next.delete(item.appointment.id)
        return next
      })
    }
  }

  const runBatch = async () => {
    const ids = Array.from(selected)
    if (ids.length === 0) return
    setConfirming((prev) => new Set([...prev, ...ids]))
    let ok = 0
    let fail = 0
    for (const id of ids) {
      try {
        await updateAppointment(id, { status: 'realizado' })
        ok += 1
      } catch {
        fail += 1
      }
    }
    setAppointments((prev) => prev.filter((a) => !ids.includes(a.id)))
    setSelected(new Set())
    setBatchConfirmOpen(false)
    if (fail === 0) {
      toast.success(`${ok} atendimento(s) marcado(s) como realizado`)
    } else {
      toast.warning(`${ok} confirmado(s), ${fail} com erro — revise e tente novamente`)
    }
    setConfirming(new Set())
  }

  if (loading) {
    return (
      <Card className="border-border/60">
        <CardContent className="p-6 space-y-3">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <RefreshCw className="w-4 h-4 animate-spin" />
            Carregando fila de reconciliação...
          </div>
          <Skeleton className="h-16 w-full rounded-xl" />
          <Skeleton className="h-16 w-full rounded-xl" />
          <Skeleton className="h-16 w-full rounded-xl" />
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="border-border/60 overflow-hidden">
      <CardContent className="p-0">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 border-b border-border/50 bg-muted/20">
          <div className="min-w-0">
            <h3 className="font-serif font-bold text-primary flex items-center gap-2">
              <ClipboardCheck className="w-4 h-4" />
              Fila de Reconciliação
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Consultas passadas ainda &quot;confirmado&quot;. Confirme como &quot;realizado&quot;
              após checar a conversa — nada é automático.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button variant="ghost" size="sm" onClick={load} className="h-8 gap-1.5 text-xs">
              <RefreshCw className="w-3.5 h-3.5" />
              Atualizar
            </Button>
            {selectedCount > 0 && (
              <Button size="sm" className="h-8 gap-1.5 text-xs" onClick={runBatch}>
                <CheckCheck className="w-3.5 h-3.5" />
                Confirmar {selectedCount} selecionado(s)
              </Button>
            )}
          </div>
        </div>

        {automationsPaused && (
          <div className="flex items-start gap-2 p-3 bg-amber-50/80 dark:bg-amber-950/20 border-b border-amber-200/60 dark:border-amber-900/40 text-xs text-amber-900 dark:text-amber-200">
            <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5" />
            <span>
              Automações globais pausadas (kill-switch). A fila continua manual — nenhum disparo
              automático acontece.
            </span>
          </div>
        )}

        {items.length === 0 ? (
          <div className="py-12 flex flex-col items-center justify-center text-center gap-2 px-6">
            <CheckCircle2 className="w-10 h-10 text-emerald-500/60" />
            <p className="text-sm font-medium text-foreground">Nada a reconciliar</p>
            <p className="text-xs text-muted-foreground max-w-xs">
              Todas as consultas passadas já estão com status final (realizado, faltou, remarcado ou
              cancelado).
            </p>
          </div>
        ) : (
          <div className="divide-y divide-border/40">
            {[...withEvidence, ...withoutEvidence].map((item) => {
              const app = item.appointment
              const start = toSafeDate(app.starts_at)
              const isSel = selected.has(app.id)
              const isConfirming = confirming.has(app.id)
              const isOpen = expanded.has(app.id)

              return (
                <div
                  key={app.id}
                  className={cn(
                    'p-4 flex flex-col gap-2 transition-colors',
                    isSel && 'bg-primary/[0.03]',
                  )}
                >
                  <div className="flex items-start gap-3">
                    <Checkbox
                      checked={isSel}
                      onCheckedChange={() => toggleSelected(app.id)}
                      className="mt-0.5"
                      aria-label={`Selecionar ${app.patient_name || 'consulta'}`}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-sm text-foreground truncate">
                          {app.patient_name?.trim() || 'Paciente sem nome'}
                        </span>
                        <Badge variant="outline" className="text-[10px] py-0">
                          {start
                            ? `${formatBrazilianDate(app.starts_at)} ${formatTimeSaoPaulo(app.starts_at)}`
                            : 'data inválida'}
                        </Badge>
                        <Badge
                          variant="outline"
                          className={cn(
                            'text-[10px] py-0',
                            item.hasDplusMinusEvidence
                              ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800'
                              : 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800',
                          )}
                        >
                          {item.hasDplusMinusEvidence
                            ? `${item.evidenceCount} msg(s) D±1`
                            : 'sem msg D±1'}
                        </Badge>
                        {start && (
                          <span className="text-[10px] text-muted-foreground">
                            {getDayDiffFromTodaySaoPaulo(start)} dia(s) atrás
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {app.city}
                        {app.location ? ` · ${app.location}` : ''} ·{' '}
                        {app.appointment_type || 'Consulta'} · Fuso: {CLINIC_TIMEZONE}
                        {item.lastEvidenceAt
                          ? ` · última msg ${formatTimeSaoPaulo(item.lastEvidenceAt.toISOString())}`
                          : ''}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 gap-1.5 text-xs shrink-0"
                      disabled={isConfirming}
                      onClick={() => confirmOne(item)}
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      {isConfirming ? 'Confirmando...' : 'Marcar realizado'}
                    </Button>
                  </div>

                  <div className="pl-8 flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        setExpanded((prev) => {
                          const next = new Set(prev)
                          if (next.has(app.id)) next.delete(app.id)
                          else next.add(app.id)
                          return next
                        })
                      }
                      className="text-[11px] text-primary hover:underline flex items-center gap-1"
                    >
                      <MessageSquare className="w-3 h-3" />
                      {isOpen ? 'Esconder evidência' : 'Ver evidência (metadados)'}
                    </button>
                    {isOpen && (
                      <span className="text-[11px] text-muted-foreground">
                        {item.evidenceCount} mensagem(ns) trocada(s) com a paciente entre{' '}
                        {start
                          ? formatBrazilianDate(
                              new Date(
                                start.getTime() - EVIDENCE_WINDOW_DAYS * 86400_000,
                              ).toISOString(),
                            )
                          : '—'}{' '}
                        e{' '}
                        {start
                          ? formatBrazilianDate(
                              new Date(
                                start.getTime() + EVIDENCE_WINDOW_DAYS * 86400_000,
                              ).toISOString(),
                            )
                          : '—'}
                        . Por LGPD, o conteúdo permanece no CRM — abra a conversa para ler.
                      </span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
