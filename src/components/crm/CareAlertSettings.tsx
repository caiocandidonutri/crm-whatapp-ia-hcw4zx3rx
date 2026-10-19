import { useState, useEffect, useCallback } from 'react'
import { Phone, Save, Loader2, Clock, Moon, PauseCircle } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { toast } from 'sonner'
import {
  getCareAlertSettings,
  saveCareAlertSettings,
  toggleGlobalAutomations,
} from '@/services/care_alerts_service'
import { extractFieldErrors, type FieldErrors } from '@/lib/pocketbase/errors'

interface CareAlertSettingsProps {
  accountId: string
}

export function CareAlertSettings({ accountId }: CareAlertSettingsProps) {
  const [phone, setPhone] = useState('')
  const [followupEnabled, setFollowupEnabled] = useState(true)
  const [needsCareEnabled, setNeedsCareEnabled] = useState(true)
  const [confirmationEnabled, setConfirmationEnabled] = useState(true)
  const [hoursBefore, setHoursBefore] = useState(48)
  const [remindersEnabled, setRemindersEnabled] = useState(true)
  const [recallEnabled, setRecallEnabled] = useState(true)
  const [recallDaysInactive, setRecallDaysInactive] = useState(14)
  const [clubRecallDaysInactive, setClubRecallDaysInactive] = useState(45)
  const [budgetFollowupDays, setBudgetFollowupDays] = useState(7)
  const [renewalAlertDaysBefore, setRenewalAlertDaysBefore] = useState(15)
  const [return30dRuleEnabled, setReturn30dRuleEnabled] = useState(true)
  const [budgetFollowupEnabled, setBudgetFollowupEnabled] = useState(true)
  const [renewalAlertEnabled, setRenewalAlertEnabled] = useState(true)
  const [recallDailyLimit, setRecallDailyLimit] = useState(15)
  const [globalPaused, setGlobalPaused] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [togglingKill, setTogglingKill] = useState(false)
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})

  const DEFAULT_DR_CAIO_PHONE = '553599288027'

  const load = useCallback(async () => {
    try {
      const settings = await getCareAlertSettings(accountId)
      if (settings) {
        setPhone(settings.whatsapp_alert_phone || DEFAULT_DR_CAIO_PHONE)
        setFollowupEnabled(settings.followup_alert_enabled ?? true)
        setNeedsCareEnabled(settings.needs_care_alert_enabled ?? true)
        setConfirmationEnabled(settings.confirmation_alert_enabled ?? true)
        setHoursBefore(settings.confirmation_hours_before ?? 48)
        setRemindersEnabled(settings.reminders_enabled ?? true)
        setRecallEnabled(settings.recall_enabled ?? true)
        setRecallDaysInactive(settings.recall_days_inactive ?? 14)
        setClubRecallDaysInactive(settings.club_recall_days_inactive ?? 45)
        setReturn30dRuleEnabled(settings.return_30d_rule_enabled ?? true)
        setGlobalPaused(settings.global_automations_paused ?? false)
        // O toggle de cada régua é derivado do próprio campo de dias
        // (0 = régua desligada — é assim que o cron do backend interpreta).
        const budgetDays = settings.budget_followup_days ?? 7
        const renewalDays = settings.renewal_alert_days_before ?? 15
        setBudgetFollowupDays(budgetDays > 0 ? budgetDays : 7)
        setRenewalAlertDaysBefore(renewalDays > 0 ? renewalDays : 15)
        setBudgetFollowupEnabled(budgetDays > 0)
        setRenewalAlertEnabled(renewalDays > 0)
      }
    } catch {
      /* defaults */
    }
    setLoading(false)
  }, [accountId])

  useEffect(() => {
    load()
  }, [load])

  const handleSave = async () => {
    setSaving(true)
    setFieldErrors({})
    try {
      await saveCareAlertSettings(accountId, {
        whatsapp_alert_phone: phone,
        followup_alert_enabled: followupEnabled,
        needs_care_alert_enabled: needsCareEnabled,
        confirmation_alert_enabled: confirmationEnabled,
        confirmation_hours_before: hoursBefore,
        reminders_enabled: remindersEnabled,
        recall_enabled: recallEnabled,
        recall_days_inactive: recallDaysInactive,
        club_recall_days_inactive: clubRecallDaysInactive,
        // Toggle das réguas é persistido no próprio campo de dias:
        // desligar grava 0 (régua desativada no cron); ligar grava os dias.
        budget_followup_days: budgetFollowupEnabled ? Math.max(1, budgetFollowupDays) : 0,
        renewal_alert_days_before: renewalAlertEnabled ? Math.max(1, renewalAlertDaysBefore) : 0,
        return_30d_rule_enabled: return30dRuleEnabled,
        recall_daily_limit: recallDailyLimit,
      })
      toast.success('Configurações salvas')
    } catch (err) {
      setFieldErrors(extractFieldErrors(err))
      toast.error('Erro ao salvar configurações')
    } finally {
      setSaving(false)
    }
  }

  const handleToggleKillSwitch = async (val: boolean) => {
    setTogglingKill(true)
    try {
      const res = await toggleGlobalAutomations(val, accountId)
      setGlobalPaused(!!res.paused)
      toast.success(val ? 'Mensagens automáticas pausadas' : 'Mensagens automáticas reativadas')
    } catch (err) {
      console.error('Erro ao alternar kill-switch global:', err)
      setGlobalPaused((prev) => !prev)
      toast.error('Erro ao atualizar kill-switch global')
    } finally {
      setTogglingKill(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold text-primary uppercase tracking-wider">Configurações</h3>
      <div className="space-y-2">
        <Label className="text-sm">WhatsApp para alertas</Label>
        <div className="relative">
          <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="(11) 99999-9999"
            className="pl-9"
          />
        </div>
        {fieldErrors.whatsapp_alert_phone && (
          <p className="text-xs text-destructive">{fieldErrors.whatsapp_alert_phone}</p>
        )}
        <p className="text-xs text-muted-foreground">
          Número que receberá os alertas de cuidado via WhatsApp.
        </p>
      </div>

      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <Label className="text-sm">Alertar follow-up gerado</Label>
          <p className="text-xs text-muted-foreground">
            Quando um follow-up pós-consulta for criado
          </p>
        </div>
        <Switch checked={followupEnabled} onCheckedChange={setFollowupEnabled} />
      </div>

      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <Label className="text-sm">Alertar paciente precisa de cuidado</Label>
          <p className="text-xs text-muted-foreground">Quando um paciente precisar de atenção</p>
        </div>
        <Switch checked={needsCareEnabled} onCheckedChange={setNeedsCareEnabled} />
      </div>

      <Separator />

      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <Label className="text-sm flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5" />
              Lembrete de confirmação 24h
            </Label>
            <p className="text-xs text-muted-foreground">
              Envia lembrete no dia anterior à consulta
            </p>
          </div>
          <Switch checked={confirmationEnabled} onCheckedChange={setConfirmationEnabled} />
        </div>
        {confirmationEnabled && (
          <div className="space-y-1.5 pl-1">
            <Label className="text-xs text-muted-foreground">
              Horas de antecedência (Régua 1: padrão 48h)
            </Label>
            <Input
              type="number"
              min={1}
              max={168}
              value={hoursBefore}
              onChange={(e) => setHoursBefore(Math.max(1, Number(e.target.value) || 48))}
              className="h-9 w-28"
            />
            {fieldErrors.confirmation_hours_before && (
              <p className="text-xs text-destructive">{fieldErrors.confirmation_hours_before}</p>
            )}
            <p className="text-xs text-muted-foreground">
              Configurável: 48h antes da consulta para confirmação formal, mantendo o lembrete do
              dia.
            </p>
          </div>
        )}
      </div>

      <Separator />

      {/* Réguas da Fase 2 */}
      <div className="space-y-4">
        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          Réguas de Cuidado (Fase 2)
        </h4>

        {/* Régua 2: Retorno 30d */}
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <Label className="text-sm font-medium">Régua Retorno 30d</Label>
            <p className="text-xs text-muted-foreground">
              Gera tarefa para pacientes de 1ª consulta sem retorno quando completar 30 dias
            </p>
          </div>
          <Switch checked={return30dRuleEnabled} onCheckedChange={setReturn30dRuleEnabled} />
        </div>

        {/* Régua 4: Orçamento 7d (toggle + dias) */}
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <Label className="text-sm font-medium">Régua Orçamento Enviado (7d)</Label>
            <p className="text-xs text-muted-foreground">
              Contato na etapa 'Orçamento Enviado' sem resposta gera follow-up de alta prioridade
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Input
              type="number"
              min={1}
              max={60}
              value={budgetFollowupDays}
              onChange={(e) => setBudgetFollowupDays(Math.max(1, Number(e.target.value) || 7))}
              className="h-9 w-20 text-right"
              disabled={!budgetFollowupEnabled}
            />
            <span className="text-xs text-muted-foreground w-10">dias</span>
            <Switch checked={budgetFollowupEnabled} onCheckedChange={setBudgetFollowupEnabled} />
          </div>
        </div>

        {/* Régua 5: Renovação de Plano (toggle + dias) */}
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <Label className="text-sm font-medium">Régua Renovação Plano/Clube</Label>
            <p className="text-xs text-muted-foreground">
              Gera tarefa quando o plano/clube do paciente vencer em X dias
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Input
              type="number"
              min={1}
              max={60}
              value={renewalAlertDaysBefore}
              onChange={(e) => setRenewalAlertDaysBefore(Math.max(1, Number(e.target.value) || 15))}
              className="h-9 w-20 text-right"
              disabled={!renewalAlertEnabled}
            />
            <span className="text-xs text-muted-foreground w-10">dias</span>
            <Switch checked={renewalAlertEnabled} onCheckedChange={setRenewalAlertEnabled} />
          </div>
        </div>

        <Separator />

        {/* Kill-switch global + Night Shield (21h-07h) */}
        <div className="p-3 rounded-xl border border-border/60 bg-muted/20 space-y-2">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <Label className="text-sm font-medium flex items-center gap-1.5">
                <PauseCircle className="w-3.5 h-3.5 text-rose-500" />
                Kill-switch global
              </Label>
              <p className="text-xs text-muted-foreground">
                Pausa TODAS as mensagens automáticas (réguas, lembretes, recall e IA)
              </p>
            </div>
            <Switch
              checked={globalPaused}
              onCheckedChange={handleToggleKillSwitch}
              disabled={togglingKill}
            />
          </div>
          <div className="flex items-center justify-between gap-3 pt-1">
            <div className="min-w-0">
              <Label className="text-sm font-medium flex items-center gap-1.5">
                <Moon className="w-3.5 h-3.5 text-indigo-500" />
                Night Shield (21h – 07h)
              </Label>
              <p className="text-xs text-muted-foreground">
                Nenhuma mensagem automática sai durante a noite
              </p>
            </div>
            <Badge variant="outline" className="text-[10px] font-semibold shrink-0">
              Sempre ativo
            </Badge>
          </div>
        </div>
      </div>

      <Separator />

      {/* Lembretes automáticos e Recall */}
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <Label className="text-sm font-medium">Lembretes automáticos de agendamento</Label>
            <p className="text-xs text-muted-foreground">
              Dispara confirmação 24h com preparo, lembrete 2-3h antes e follow-up único
            </p>
          </div>
          <Switch checked={remindersEnabled} onCheckedChange={setRemindersEnabled} />
        </div>

        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <Label className="text-sm font-medium">Recall de pacientes inativos</Label>
            <p className="text-xs text-muted-foreground">
              Disparo diário de mensagem acolhedora para pacientes sem contato recente
            </p>
          </div>
          <Switch checked={recallEnabled} onCheckedChange={setRecallEnabled} />
        </div>

        {recallEnabled && (
          <div className="grid grid-cols-3 gap-3 pl-1 pt-1">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Pacientes Gerais</Label>
              <div className="flex items-center gap-1">
                <Input
                  type="number"
                  min={1}
                  max={365}
                  value={recallDaysInactive}
                  onChange={(e) => setRecallDaysInactive(Math.max(1, Number(e.target.value) || 14))}
                  className="h-9"
                />
                <span className="text-xs text-muted-foreground">dias</span>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Clube 45D</Label>
              <div className="flex items-center gap-1">
                <Input
                  type="number"
                  min={1}
                  max={365}
                  value={clubRecallDaysInactive}
                  onChange={(e) =>
                    setClubRecallDaysInactive(Math.max(1, Number(e.target.value) || 45))
                  }
                  className="h-9"
                />
                <span className="text-xs text-muted-foreground">dias</span>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Limite diário</Label>
              <Input
                type="number"
                min={1}
                max={100}
                value={recallDailyLimit}
                onChange={(e) => setRecallDailyLimit(Math.max(1, Number(e.target.value) || 15))}
                className="h-9"
              />
            </div>
          </div>
        )}
      </div>

      <Button onClick={handleSave} disabled={saving} className="w-full">
        {saving ? (
          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
        ) : (
          <Save className="w-4 h-4 mr-2" />
        )}
        Salvar
      </Button>
    </div>
  )
}
