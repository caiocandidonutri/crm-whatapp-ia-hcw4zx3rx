import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import {
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Copy,
  Wifi,
  Webhook,
  Clock,
  RefreshCw,
  Activity,
} from 'lucide-react'

type DiagnosticModalProps = {
  result: any | null
  onClose: () => void
}

function formatRelativeTime(secondsAgo: number): string {
  if (secondsAgo < 0) return 'Desconhecido'
  if (secondsAgo < 60) return `${secondsAgo} segundos atrás`
  if (secondsAgo < 3600) return `há ${Math.floor(secondsAgo / 60)} min`
  if (secondsAgo < 86400) return `há ${Math.floor(secondsAgo / 3600)}h`
  return `há ${Math.floor(secondsAgo / 86400)} dia(s)`
}

function formatTimestamp(ts: number): string {
  if (!ts || ts <= 0) return 'Nunca'
  return new Date(ts * 1000).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatDateRelative(dateStr: string): string {
  if (!dateStr) return 'Nunca'
  try {
    const normalized = dateStr.includes(' ') ? dateStr.replace(' ', 'T') : dateStr
    const d = new Date(normalized)
    const diffSecs = Math.floor((Date.now() - d.getTime()) / 1000)
    if (isNaN(diffSecs)) return '—'
    if (diffSecs < 0) return 'agora'
    if (diffSecs < 60) return 'há poucos segundos'
    if (diffSecs < 3600) return `há ${Math.floor(diffSecs / 60)} min`
    if (diffSecs < 86400) return `há ${Math.floor(diffSecs / 3600)}h`
    return `há ${Math.floor(diffSecs / 86400)} dia(s)`
  } catch {
    return '—'
  }
}

function formatTimeFromDate(dateStr: string): string {
  if (!dateStr) return '—'
  try {
    const normalized = dateStr.includes(' ') ? dateStr.replace(' ', 'T') : dateStr
    const d = new Date(normalized)
    if (isNaN(d.getTime())) return '—'
    return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
  } catch {
    return '—'
  }
}

function CheckCard({
  icon: Icon,
  label,
  value,
  status,
}: {
  icon: any
  label: string
  value: string
  status: 'ok' | 'warn' | 'error'
}) {
  return (
    <div
      className={cn(
        'rounded-lg border p-3 flex flex-col gap-1',
        status === 'ok' && 'border-green-500/20 bg-green-500/5',
        status === 'warn' && 'border-yellow-500/20 bg-yellow-500/5',
        status === 'error' && 'border-red-500/20 bg-red-500/5',
      )}
    >
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Icon className="w-3.5 h-3.5" />
        {label}
      </div>
      <div className="text-sm font-medium text-foreground truncate">{value}</div>
    </div>
  )
}

export function DiagnosticModal({ result, onClose }: DiagnosticModalProps) {
  if (!result) return null

  const realConnected = result.realConnected === true
  const webhookMatches = result.matches === true
  const webhookWasFixed = result.webhookWasFixed === true
  const syncStale = result.syncStale === true
  const hasLastMsg = result.lastMessage && !result.lastMessage.error

  let overall: 'healthy' | 'warning' | 'error' = 'healthy'
  if (!realConnected) {
    overall = 'error'
  } else if (syncStale || !webhookMatches) {
    overall = webhookWasFixed ? 'warning' : 'error'
  }

  const connState = result.evolutionConnectionState?.body?.instance?.state || 'desconhecido'
  const urlBefore =
    result.webhookBefore?.body?.url || result.webhookBefore?.body?.webhook?.url || ''
  const lastMsgTs = hasLastMsg ? result.lastMessage.timestamp : 0
  const lastMsgAgo = hasLastMsg ? result.lastMessage.secondsAgo : -1

  return (
    <Dialog open={!!result} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Diagnóstico do Webhook</DialogTitle>
          <DialogDescription>
            Verificação completa da sincronização entre a Evolution API e o backend.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 flex-1 overflow-hidden flex flex-col">
          <div
            className={cn(
              'p-4 rounded-lg border flex items-start gap-3 shrink-0',
              overall === 'healthy' && 'bg-green-500/10 border-green-500/20 text-green-700',
              overall === 'warning' && 'bg-yellow-500/10 border-yellow-500/20 text-yellow-700',
              overall === 'error' && 'bg-red-500/10 border-red-500/20 text-red-700',
            )}
          >
            {overall === 'healthy' && <CheckCircle2 className="w-5 h-5 mt-0.5 shrink-0" />}
            {overall === 'warning' && <AlertTriangle className="w-5 h-5 mt-0.5 shrink-0" />}
            {overall === 'error' && <XCircle className="w-5 h-5 mt-0.5 shrink-0" />}
            <div>
              <h4 className="font-semibold text-sm">
                {overall === 'healthy' && 'Sincronização saudável'}
                {overall === 'warning' && 'Webhook corrigido — aguarde confirmação'}
                {overall === 'error' && syncStale && 'Sincronização interrompida'}
                {overall === 'error' && !syncStale && 'Problema detectado na conexão'}
              </h4>
              <p className="text-xs opacity-90 mt-1">
                {overall === 'healthy' &&
                  'A instância está conectada, o webhook está correto e mensagens estão chegando.'}
                {overall === 'warning' &&
                  'O webhook foi reconfigurado. Envie uma mensagem de teste para confirmar.'}
                {overall === 'error' &&
                  syncStale &&
                  'A instância mostra "conectado" mas nenhuma mensagem recente foi recebida. O webhook pode estar parado.'}
                {overall === 'error' &&
                  !syncStale &&
                  !realConnected &&
                  'A instância não está conectada na Evolution API.'}
                {overall === 'error' &&
                  !syncStale &&
                  realConnected &&
                  'O webhook não pôde ser configurado corretamente.'}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 shrink-0">
            <CheckCard
              icon={Wifi}
              label="Conexão real"
              value={realConnected ? `Conectada (${connState})` : `Desconectada (${connState})`}
              status={realConnected ? 'ok' : 'error'}
            />
            <CheckCard
              icon={Webhook}
              label="Webhook URL"
              value={webhookMatches ? 'Correta' : webhookWasFixed ? 'Corrigida' : 'Incorreta'}
              status={webhookMatches ? (webhookWasFixed ? 'warn' : 'ok') : 'error'}
            />
            <CheckCard
              icon={Clock}
              label="Última mensagem"
              value={hasLastMsg ? formatRelativeTime(lastMsgAgo) : 'Nenhuma'}
              status={!realConnected ? 'warn' : syncStale ? 'error' : hasLastMsg ? 'ok' : 'warn'}
            />
            <CheckCard
              icon={Activity}
              label="Status do sync"
              value={!realConnected ? 'N/A' : syncStale ? 'Interrompido' : 'Ativo'}
              status={!realConnected ? 'warn' : syncStale ? 'error' : 'ok'}
            />
          </div>

          <div className="space-y-3 shrink-0">
            <div className="rounded-lg border border-border p-3 space-y-1.5">
              <h5 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                <RefreshCw className="w-3.5 h-3.5" /> Reconfiguração
              </h5>
              <div className="text-xs text-foreground space-y-0.5">
                <p>
                  <span className="text-muted-foreground">URL esperada: </span>
                  <code className="font-mono break-all">{result.expectedWebhookUrl || '—'}</code>
                </p>
                <p>
                  <span className="text-muted-foreground">URL configurada (antes): </span>
                  <code className="font-mono break-all">{urlBefore || 'vazia'}</code>
                </p>
                <p>
                  <span className="text-muted-foreground">Reconfigurado: </span>
                  {webhookWasFixed
                    ? 'Sim — webhook corrigido automaticamente'
                    : webhookMatches
                      ? 'Não era necessário'
                      : 'Falha ao reconfigurar'}
                </p>
              </div>
            </div>

            {(result.lastHealthCheckAt ||
              result.lastWebhookReconfiguredAt ||
              result.lastInstanceRestartAt) && (
              <div className="rounded-lg border border-border p-3 space-y-1.5">
                <h5 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                  <Activity className="w-3.5 h-3.5" /> Verificação automática
                </h5>
                <div className="text-xs text-foreground space-y-0.5">
                  <p>
                    <span className="text-muted-foreground">Última verificação automática: </span>
                    {result.lastHealthCheckAt
                      ? formatDateRelative(result.lastHealthCheckAt)
                      : 'Nunca'}
                  </p>
                  <p>
                    <span className="text-muted-foreground">
                      Webhook reconfigurado automaticamente:{' '}
                    </span>
                    {result.lastWebhookReconfiguredAt
                      ? `às ${formatTimeFromDate(result.lastWebhookReconfiguredAt)}`
                      : 'Nunca'}
                  </p>
                  {result.lastInstanceRestartAt && (
                    <p>
                      <span className="text-muted-foreground">
                        Última reinicialização automática:{' '}
                      </span>
                      {formatDateRelative(result.lastInstanceRestartAt)}
                    </p>
                  )}
                  {result.healthCheckFailures > 0 && (
                    <p>
                      <span className="text-muted-foreground">Falhas consecutivas: </span>
                      {result.healthCheckFailures}
                    </p>
                  )}
                </div>
              </div>
            )}

            {hasLastMsg && (
              <div className="rounded-lg border border-border p-3 space-y-1.5">
                <h5 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5" /> Última mensagem recebida
                </h5>
                <div className="text-xs text-foreground space-y-0.5">
                  <p>
                    <span className="text-muted-foreground">Data/hora: </span>
                    {formatTimestamp(lastMsgTs)}
                  </p>
                  <p>
                    <span className="text-muted-foreground">Tempo: </span>
                    {formatRelativeTime(lastMsgAgo)}
                  </p>
                  <p>
                    <span className="text-muted-foreground">Origem: </span>
                    {result.lastMessage.fromMe ? 'Enviada por mim' : 'Recebida do contato'}
                  </p>
                  {result.lastMessage.contentPreview && (
                    <p className="truncate">
                      <span className="text-muted-foreground">Conteúdo: </span>
                      {result.lastMessage.contentPreview}
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="relative flex-1 overflow-hidden rounded-md border bg-muted/50 min-h-[80px]">
            <ScrollArea className="h-full w-full p-4">
              <pre className="text-[11px] font-mono whitespace-pre-wrap break-all text-muted-foreground">
                {JSON.stringify(result, null, 2)}
              </pre>
            </ScrollArea>
            <Button
              size="sm"
              variant="secondary"
              className="absolute top-2 right-2 h-7 opacity-70 hover:opacity-100"
              onClick={() => {
                navigator.clipboard.writeText(JSON.stringify(result, null, 2))
                toast.success('Copiado para a área de transferência')
              }}
            >
              <Copy className="h-3 w-3 mr-1" /> Copiar
            </Button>
          </div>
        </div>

        <DialogFooter className="shrink-0">
          <DialogClose asChild>
            <Button variant="outline">Fechar</Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
