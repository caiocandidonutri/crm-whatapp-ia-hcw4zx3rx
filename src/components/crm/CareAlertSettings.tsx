import { useState, useEffect, useCallback } from 'react'
import { Phone, Save, Loader2, Clock } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { toast } from 'sonner'
import { getCareAlertSettings, saveCareAlertSettings } from '@/services/care_alerts_service'
import { extractFieldErrors, type FieldErrors } from '@/lib/pocketbase/errors'

interface CareAlertSettingsProps {
  accountId: string
}

export function CareAlertSettings({ accountId }: CareAlertSettingsProps) {
  const [phone, setPhone] = useState('')
  const [followupEnabled, setFollowupEnabled] = useState(true)
  const [needsCareEnabled, setNeedsCareEnabled] = useState(true)
  const [confirmationEnabled, setConfirmationEnabled] = useState(true)
  const [hoursBefore, setHoursBefore] = useState(24)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})

  const load = useCallback(async () => {
    try {
      const settings = await getCareAlertSettings(accountId)
      if (settings) {
        setPhone(settings.whatsapp_alert_phone || '')
        setFollowupEnabled(settings.followup_alert_enabled ?? true)
        setNeedsCareEnabled(settings.needs_care_alert_enabled ?? true)
        setConfirmationEnabled(settings.confirmation_alert_enabled ?? true)
        setHoursBefore(settings.confirmation_hours_before ?? 24)
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
      })
      toast.success('Configurações salvas')
    } catch (err) {
      setFieldErrors(extractFieldErrors(err))
      toast.error('Erro ao salvar configurações')
    } finally {
      setSaving(false)
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
            <Label className="text-xs text-muted-foreground">Horas de antecedência</Label>
            <Input
              type="number"
              min={1}
              max={168}
              value={hoursBefore}
              onChange={(e) => setHoursBefore(Math.max(1, Number(e.target.value) || 24))}
              className="h-9 w-28"
            />
            {fieldErrors.confirmation_hours_before && (
              <p className="text-xs text-destructive">{fieldErrors.confirmation_hours_before}</p>
            )}
            <p className="text-xs text-muted-foreground">
              Quantas horas antes da consulta o lembrete será enviado.
            </p>
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
