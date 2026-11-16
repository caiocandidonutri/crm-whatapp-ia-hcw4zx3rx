import { useCallback, useEffect, useState } from 'react'
import { pb } from '@/lib/pocketbase/client'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { Bot, RefreshCw } from 'lucide-react'
import { toast } from '@/hooks/use-toast'

interface LeadIaItem {
  id: string
  contact_name: string
  phone: string
  jid: string
  stage: string
  source: string
  pending_reply: boolean
  followup_count: number
  retry_count: number
  minutes_since_trigger: number | null
  care_state: string
}

const STAGE_LABELS: Record<string, string> = {
  lead: 'Lead novo',
  human_pending: 'Aguardando Fabiana',
  engaged: 'Engajado',
  converted: 'Convertido',
  off: 'Desligado',
}

export function LeadsIaAtivosPanel() {
  const [leads, setLeads] = useState<LeadIaItem[]>([])
  const [loading, setLoading] = useState(true)
  const [togglingId, setTogglingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const loadLeads = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await pb.send('/backend/v1/ia-lead/leads', { method: 'GET' })
      const data = res as { success?: boolean; leads?: LeadIaItem[]; error?: string }
      if (data && data.success) {
        setLeads(data.leads || [])
      } else {
        setError(data?.error || 'Falha ao carregar leads IA')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao carregar leads IA')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadLeads()
  }, [loadLeads])

  const handleToggle = async (lead: LeadIaItem, active: boolean) => {
    setTogglingId(lead.id)
    try {
      await pb.send('/backend/v1/ia-lead/toggle', {
        method: 'POST',
        body: JSON.stringify({ contact_id: lead.id, active }),
      })
      toast({
        title: active ? 'IA ativada' : 'IA desativada',
        description: active
          ? `Fabiana IA assumiu o atendimento de ${lead.contact_name || lead.phone}.`
          : `Fabiana IA saiu do atendimento de ${lead.contact_name || lead.phone}.`,
      })
      await loadLeads()
    } catch (err) {
      toast({
        title: 'Erro ao alternar IA',
        description: err instanceof Error ? err.message : 'Tente novamente',
        variant: 'destructive',
      })
    } finally {
      setTogglingId(null)
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between space-y-0">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            <Bot className="h-4 w-4" /> Leads IA ativos
          </CardTitle>
          <CardDescription>
            Leads de tráfego pago atendidos pela Fabiana IA. Desligue para assumir manualmente.
          </CardDescription>
        </div>
        <Button variant="ghost" size="icon" onClick={loadLeads} disabled={loading}>
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
        </Button>
      </CardHeader>
      <CardContent>
        {error && <p className="mb-3 text-sm text-destructive">{error}</p>}
        {!loading && leads.length === 0 && !error && (
          <p className="py-4 text-center text-sm text-muted-foreground">
            Nenhum lead de IA ativo no momento.
          </p>
        )}
        <div className="space-y-2">
          {leads.map((lead) => (
            <div
              key={lead.id}
              className="flex items-center justify-between gap-3 rounded-lg border p-3"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate text-sm font-medium">
                    {lead.contact_name || lead.phone}
                  </span>
                  <Badge variant="outline">{STAGE_LABELS[lead.stage] || lead.stage || '—'}</Badge>
                  {lead.pending_reply && (
                    <Badge className="bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200">
                      Respondendo…
                    </Badge>
                  )}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {lead.phone}
                  {lead.minutes_since_trigger !== null &&
                    ` · último estímulo há ${lead.minutes_since_trigger} min`}
                  {lead.followup_count > 0 && ` · ${lead.followup_count} follow-up(s)`}
                  {lead.retry_count > 0 && ` · ${lead.retry_count} tentativa(s)`}
                </p>
              </div>
              <Switch
                checked={lead.stage !== 'off'}
                disabled={togglingId === lead.id}
                onCheckedChange={(checked) => handleToggle(lead, checked)}
                aria-label={`Alternar IA para ${lead.contact_name || lead.phone}`}
              />
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
