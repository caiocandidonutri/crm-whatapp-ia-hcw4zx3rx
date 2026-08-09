import { useState, useEffect, useCallback } from 'react'
import { Phone, Save, Loader2 } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
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
