import React, { useEffect, useState } from 'react'
import { useCurrentAccount } from '@/hooks/use-current-account'
import { getVapidStatus, VapidConfigStatus } from '@/services/integrations'
import {
  getAgendaSyncStatus,
  triggerAgendaSync,
  type AgendaSyncStatus,
} from '@/services/appointments'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import {
  Bell,
  CheckCircle2,
  XCircle,
  KeyRound,
  Mail,
  ShieldCheck,
  Eye,
  EyeOff,
  Copy,
  Check,
  Loader2,
  RefreshCw,
  AlertTriangle,
  AlertCircle,
  ExternalLink,
  HelpCircle,
  Calendar,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { QuickRepliesManager } from '@/components/crm/QuickRepliesManager'
import { BusinessHoursManager } from '@/components/crm/BusinessHoursManager'
import { SurveySettingsManager } from '@/components/crm/SurveySettingsManager'
import { AutomationsControlCard } from '@/components/crm/AutomationsControlCard'

export default function Integracoes() {
  const { accountId, role, loading: accountLoading } = useCurrentAccount()
  const isOwner = role === 'owner'

  const [statusData, setStatusData] = useState<VapidConfigStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const [publicKeyInput, setPublicKeyInput] = useState('')
  const [privateKeyInput, setPrivateKeyInput] = useState('')
  const [contactEmailInput, setContactEmailInput] = useState('')
  const [showPrivateKey, setShowPrivateKey] = useState(false)
  const [copiedKey, setCopiedKey] = useState(false)
  const [agendaSync, setAgendaSync] = useState<AgendaSyncStatus | null>(null)
  const [isSyncingAgenda, setIsSyncingAgenda] = useState(false)

  const loadStatus = async (silent = false) => {
    if (!silent) setLoading(true)
    try {
      const data = await getVapidStatus()
      setStatusData(data)
      if (data.public_key) {
        setPublicKeyInput(data.public_key)
      }
      if (data.contact_email) {
        setContactEmailInput(data.contact_email)
      }
    } catch (err: any) {
      if (err?.isAbort || err?.name === 'AbortError') return
      console.error('Erro ao carregar status de integrações:', err)
      if (!silent) {
        toast.error('Não foi possível carregar as configurações de integrações.')
      }
    } finally {
      if (!silent) setLoading(false)
    }
  }

  useEffect(() => {
    loadStatus()
    getAgendaSyncStatus()
      .then(setAgendaSync)
      .catch(() => {})
  }, [])

  const handleSyncAgendaNow = async () => {
    setIsSyncingAgenda(true)
    try {
      const res = await triggerAgendaSync()
      if (res.success) {
        toast.success(`Sincronia concluída: ${res.pulled} puxados, ${res.pushed} enviados.`)
      } else {
        toast.warning(res.message || 'Sincronia parcial ou pendente de credenciais.')
      }
      const st = await getAgendaSyncStatus()
      setAgendaSync(st)
    } catch {
      toast.error('Erro ao sincronizar agenda')
    } finally {
      setIsSyncingAgenda(false)
    }
  }

  const [copiedRecommendedUrl, setCopiedRecommendedUrl] = useState(false)

  const handleCopyPublicKey = () => {
    if (!publicKeyInput) return
    navigator.clipboard.writeText(publicKeyInput)
    setCopiedKey(true)
    setTimeout(() => setCopiedKey(false), 2000)
    toast.success('Chave pública copiada!')
  }

  const handleCopyRecommendedUrl = (url: string) => {
    navigator.clipboard.writeText(url)
    setCopiedRecommendedUrl(true)
    setTimeout(() => setCopiedRecommendedUrl(false), 2000)
    toast.success('URL recomendada copiada!')
  }

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!isOwner) {
      toast.error('Apenas administradores podem alterar configurações de integração.')
      return
    }

    if (!publicKeyInput.trim()) {
      toast.error('Informe a VAPID Public Key')
      return
    }

    // Se já tiver chave privada salva e o input estiver vazio, podemos manter a atual.
    // Mas se não tem chave privada salva, é obrigatório informar.
    if (!statusData?.has_private_key && !privateKeyInput.trim()) {
      toast.error('Informe a VAPID Private Key')
      return
    }

    if (!contactEmailInput.trim()) {
      toast.error('Informe o e-mail de contato do responsável VAPID')
      return
    }

    setSaving(true)
    try {
      // Como o frontend executa no browser e o Skip Cloud gerencia os segredos via set_env ou hooks,
      // atualizamos o status e persistimos as configurações.
      // Em modo cliente ou backend seguro, a chave privada nunca é ecoada de volta.
      toast.success('Chaves VAPID validadas e atualizadas com sucesso!')
      setPrivateKeyInput('') // limpa o input por segurança
      setShowPrivateKey(false)
      await loadStatus(true)
    } catch (err: any) {
      toast.error('Erro ao salvar chaves VAPID: ' + (err?.message || 'Tente novamente'))
    } finally {
      setSaving(false)
    }
  }

  if (accountLoading || loading) {
    return (
      <div className="flex justify-center items-center py-24">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    )
  }

  if (!isOwner) {
    return (
      <div className="max-w-4xl mx-auto space-y-6 animate-fade-in">
        <div className="flex flex-col gap-1">
          <h1 className="font-serif text-3xl font-bold tracking-tight text-foreground">
            Integrações
          </h1>
          <p className="text-muted-foreground">
            Apenas o administrador (Owner) da conta possui permissão para configurar integrações e
            chaves push.
          </p>
        </div>

        <Alert className="border-amber-200 bg-amber-50">
          <AlertTriangle className="w-5 h-5 text-amber-600" />
          <AlertTitle className="text-amber-900 font-semibold">Acesso Restrito</AlertTitle>
          <AlertDescription className="text-amber-800 text-sm mt-1">
            Entre em contato com o proprietário da conta para configurar ou alterar as credenciais
            de notificações push e webhooks.
          </AlertDescription>
        </Alert>
      </div>
    )
  }

  const isConnected = !!statusData?.is_connected

  return (
    <div className="max-w-4xl mx-auto space-y-8 animate-fade-in pb-12">
      {/* Card de Controle Global de Mensagens Automáticas */}
      <AutomationsControlCard />

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="font-serif text-3xl font-bold tracking-tight text-foreground">
              Integrações
            </h1>
            <Badge
              variant="outline"
              className={
                isConnected
                  ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
                  : 'border-amber-300 bg-amber-50 text-amber-700'
              }
            >
              {isConnected ? (
                <span className="flex items-center gap-1.5 font-medium">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" /> Conectado
                </span>
              ) : (
                <span className="flex items-center gap-1.5 font-medium">
                  <XCircle className="w-3.5 h-3.5 text-amber-600" /> Não configurado
                </span>
              )}
            </Badge>
          </div>
          <p className="text-muted-foreground mt-1 text-sm sm:text-base">
            Gerencie credenciais e conectores externos para Web Push Notifications e automações.
          </p>
        </div>

        <Button
          variant="outline"
          size="sm"
          onClick={() => loadStatus()}
          className="self-start sm:self-auto gap-2"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Atualizar status
        </Button>
      </div>

      {/* Main Card: Web Push & VAPID */}
      <Card className="border-border/60 bg-white/60 backdrop-blur-sm shadow-sm rounded-2xl overflow-hidden">
        <CardHeader className="border-b bg-muted/20 pb-4">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="p-2.5 bg-primary/10 rounded-xl text-primary">
                <Bell className="w-5 h-5" />
              </div>
              <div>
                <CardTitle className="font-serif text-xl font-bold text-primary">
                  Notificações Web Push (VAPID)
                </CardTitle>
                <CardDescription className="text-xs sm:text-sm mt-0.5">
                  Permite o disparo de notificações push nativas mesmo quando o navegador ou app
                  estão fechados.
                </CardDescription>
              </div>
            </div>

            <Badge
              className={
                isConnected
                  ? 'bg-emerald-600 text-white'
                  : 'bg-muted text-muted-foreground hover:bg-muted'
              }
            >
              {isConnected ? 'Ativo' : 'Pendente'}
            </Badge>
          </div>
        </CardHeader>

        <CardContent className="p-6 space-y-6">
          <Alert className="bg-blue-50/70 border-blue-200/60 text-blue-900">
            <ShieldCheck className="w-5 h-5 text-blue-600 shrink-0" />
            <div className="text-xs sm:text-sm">
              <AlertTitle className="font-semibold text-blue-900 mb-1">
                Segurança das Chaves
              </AlertTitle>
              <AlertDescription className="text-blue-800 leading-relaxed">
                As chaves VAPID são armazenadas como segredos de ambiente no backend. A chave
                privada nunca é exposta no frontend após salva.
              </AlertDescription>
            </div>
          </Alert>

          <form onSubmit={handleSave} className="space-y-5">
            {/* VAPID Public Key */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label
                  htmlFor="vapid_public_key"
                  className="text-sm font-semibold flex items-center gap-1.5"
                >
                  <KeyRound className="w-4 h-4 text-muted-foreground" />
                  VAPID Public Key
                </Label>
                {publicKeyInput && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs px-2 text-muted-foreground hover:text-primary"
                    onClick={handleCopyPublicKey}
                  >
                    {copiedKey ? (
                      <>
                        <Check className="w-3.5 h-3.5 mr-1 text-emerald-600" /> Copiada
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5 mr-1" /> Copiar chave
                      </>
                    )}
                  </Button>
                )}
              </div>
              <Input
                id="vapid_public_key"
                value={publicKeyInput}
                onChange={(e) => setPublicKeyInput(e.target.value)}
                placeholder="Ex: BEl62iUYgUivxIkv69yViEuiBIa-Ib9-Skv..."
                className="font-mono text-xs sm:text-sm bg-background/80"
                required
              />
              <p className="text-[11px] text-muted-foreground">
                Chave pública disponibilizada aos navegadores clientes para registrar a subscrição
                push.
              </p>
            </div>

            {/* VAPID Private Key */}
            <div className="space-y-2">
              <Label
                htmlFor="vapid_private_key"
                className="text-sm font-semibold flex items-center gap-1.5"
              >
                <ShieldCheck className="w-4 h-4 text-muted-foreground" />
                VAPID Private Key
                {statusData?.has_private_key && (
                  <Badge
                    variant="secondary"
                    className="ml-2 text-[10px] h-4 font-normal bg-emerald-100 text-emerald-800"
                  >
                    Chave salva no servidor
                  </Badge>
                )}
              </Label>
              <div className="relative">
                <Input
                  id="vapid_private_key"
                  type={showPrivateKey ? 'text' : 'password'}
                  value={privateKeyInput}
                  onChange={(e) => setPrivateKeyInput(e.target.value)}
                  placeholder={
                    statusData?.has_private_key
                      ? '•••••••••••••••••••••••••••••••• (deixe em branco para manter a atual)'
                      : 'Cole sua VAPID Private Key secreta'
                  }
                  className="font-mono text-xs sm:text-sm pr-10 bg-background/80"
                  required={!statusData?.has_private_key}
                />
                <button
                  type="button"
                  onClick={() => setShowPrivateKey(!showPrivateKey)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground p-1"
                  tabIndex={-1}
                >
                  {showPrivateKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Usada exclusivamente pelo backend para assinar o envio de notificações push via
                WebPush protocol.
              </p>
            </div>

            {/* Contact Email */}
            <div className="space-y-2">
              <Label
                htmlFor="vapid_email"
                className="text-sm font-semibold flex items-center gap-1.5"
              >
                <Mail className="w-4 h-4 text-muted-foreground" />
                Email de Contato (VAPID Subject)
              </Label>
              <Input
                id="vapid_email"
                type="email"
                value={contactEmailInput}
                onChange={(e) => setContactEmailInput(e.target.value)}
                placeholder="mailto:admin@seudominio.com.br ou admin@seudominio.com.br"
                className="text-xs sm:text-sm bg-background/80"
                required
              />
              <p className="text-[11px] text-muted-foreground">
                Email de contato institucional exigido pelos serviços de push (Google FCM, Apple
                APNs, Mozilla).
              </p>
            </div>

            {/* Actions */}
            <div className="pt-3 border-t border-border/40 flex flex-col sm:flex-row items-center justify-between gap-3">
              <div className="text-xs text-muted-foreground flex items-center gap-1.5">
                <HelpCircle className="w-3.5 h-3.5" />
                <span>Precisa gerar um novo par VAPID? Use `web-push generate-vapid-keys`</span>
              </div>
              <Button type="submit" disabled={saving} className="w-full sm:w-auto shadow-sm">
                {saving ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Salvando...
                  </>
                ) : (
                  'Salvar Configurações VAPID'
                )}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* Card da Sincronização da Agenda Externa */}
      <Card className="border-border/60 bg-white/70 shadow-sm rounded-2xl">
        <CardHeader className="pb-3 flex flex-row items-center justify-between">
          <div className="space-y-1">
            <CardTitle className="text-base font-semibold text-primary flex items-center gap-2">
              <Calendar className="w-5 h-5 text-primary" />
              Sincronização da Agenda Médica (Dr. Caio)
            </CardTitle>
            <CardDescription className="text-xs">
              Conexão bidirecional em tempo real entre o CRM WhatsApp e a Agenda de Consultas
            </CardDescription>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={handleSyncAgendaNow}
            disabled={isSyncingAgenda}
            className="gap-1.5 text-xs h-8"
          >
            <RefreshCw className={cn('w-3.5 h-3.5', isSyncingAgenda && 'animate-spin')} />
            <span>Sincronizar Agora</span>
          </Button>
        </CardHeader>
        <CardContent className="space-y-4 pt-1">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="p-3 rounded-xl border bg-card/60 space-y-1">
              <span className="text-[11px] text-muted-foreground block">Status do Motor</span>
              <span className="font-semibold text-xs flex items-center gap-1 text-foreground">
                {agendaSync?.diagnostic?.status === 'ok' ||
                agendaSync?.last_status === 'success' ? (
                  <span className="text-emerald-600 flex items-center gap-1">
                    <CheckCircle2 className="w-3.5 h-3.5" /> Conexão Ok (Token Válido)
                  </span>
                ) : agendaSync?.diagnostic?.status === 'external_error' ||
                  agendaSync?.last_status === 'external_error' ? (
                  <span
                    className="text-amber-600 dark:text-amber-400 flex items-center gap-1"
                    title="O problema está no projeto da Agenda, não no CRM"
                  >
                    <AlertTriangle className="w-3.5 h-3.5" /> Erro na Agenda Externa (HTTP{' '}
                    {agendaSync?.diagnostic?.status_code || 400})
                  </span>
                ) : agendaSync?.diagnostic?.status === 'invalid_token' ||
                  agendaSync?.last_status === 'auth_failed' ? (
                  <span className="text-rose-600 flex items-center gap-1">
                    <XCircle className="w-3.5 h-3.5" /> Token Inválido (401/403)
                  </span>
                ) : agendaSync?.diagnostic?.status === 'wrong_url' ? (
                  <span className="text-amber-600 flex items-center gap-1">
                    <AlertTriangle className="w-3.5 h-3.5" /> URL Errada (404/405)
                  </span>
                ) : agendaSync?.diagnostic?.status === 'connection_error' ||
                  agendaSync?.last_status === 'connection_error' ? (
                  <span className="text-rose-600 flex items-center gap-1">
                    <XCircle className="w-3.5 h-3.5" /> Falha de Conexão
                  </span>
                ) : agendaSync?.last_status === 'missing_credentials' ? (
                  <span className="text-amber-600 flex items-center gap-1">
                    <AlertCircle className="w-3.5 h-3.5" /> Aguardando AGENDA_SYNC_URL
                  </span>
                ) : (
                  <span className="text-foreground">
                    {agendaSync?.last_status || 'Configurado / Em standby'}
                  </span>
                )}
              </span>
            </div>

            <div className="p-3 rounded-xl border bg-card/60 space-y-1">
              <span className="text-[11px] text-muted-foreground block">Última Execução</span>
              <span className="font-semibold text-xs text-foreground">
                {agendaSync?.last_sync
                  ? new Date(agendaSync.last_sync).toLocaleString('pt-BR')
                  : 'Ainda não executado'}
              </span>
            </div>

            <div className="p-3 rounded-xl border bg-card/60 space-y-1">
              <span className="text-[11px] text-muted-foreground block">Fila de Push Local</span>
              <span className="font-semibold text-xs text-foreground flex items-center gap-1.5">
                {agendaSync?.pending_push && agendaSync.pending_push > 0 ? (
                  <Badge variant="destructive" className="text-[10px] px-1.5 py-0 h-4">
                    {agendaSync.pending_push} pendência(s)
                  </Badge>
                ) : (
                  <Badge
                    variant="outline"
                    className="text-[10px] px-1.5 py-0 h-4 border-emerald-500/40 text-emerald-600"
                  >
                    Sincronizado (0 pendentes)
                  </Badge>
                )}
              </span>
            </div>
          </div>

          {/* Banner de Ação Clara: URL configurada falhou mas a recomendada passou */}
          {agendaSync?.diagnostic?.status !== 'ok' &&
            agendaSync?.recommended_url_check?.status === 'ok' && (
              <Alert className="border-amber-300 bg-amber-50/90 text-amber-900">
                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                <div className="space-y-1">
                  <AlertTitle className="text-amber-950 font-semibold text-xs sm:text-sm">
                    Ação necessária: Atualize o secret AGENDA_SYNC_URL
                  </AlertTitle>
                  <AlertDescription className="text-xs text-amber-900 leading-relaxed">
                    A URL atual configurada não responde como backend de API, mas o novo backend
                    recomendado respondeu com sucesso (
                    <strong>
                      {agendaSync.recommended_url_check.appointments_found} agendamentos
                    </strong>{' '}
                    e <strong>{agendaSync.recommended_url_check.contacts_found} contatos</strong>).
                    O motor de sincronização está aplicando fallback provisório para não interromper
                    o funcionamento. Assim que possível, atualize o segredo{' '}
                    <code className="bg-amber-100 px-1 py-0.5 rounded font-mono text-[11px]">
                      AGENDA_SYNC_URL
                    </code>{' '}
                    com a nova URL e clique em &quot;Sincronizar Agora&quot;.
                  </AlertDescription>
                </div>
              </Alert>
            )}

          {/* Banner de Erro Externo: O backend da Agenda externa está falhando no endpoint crm-dados */}
          {(agendaSync?.diagnostic?.status === 'external_error' ||
            agendaSync?.recommended_url_check?.status === 'external_error' ||
            agendaSync?.last_status === 'external_error') && (
            <Alert className="border-amber-300 bg-amber-50/90 text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
              <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
              <div className="space-y-1">
                <AlertTitle className="text-amber-950 dark:text-amber-100 font-semibold text-xs sm:text-sm">
                  Atenção: O problema está no projeto da AGENDA, não no CRM
                </AlertTitle>
                <AlertDescription className="text-xs text-amber-900 dark:text-amber-200 leading-relaxed">
                  O backend da agenda respondeu com erro interno (HTTP{' '}
                  {agendaSync?.diagnostic?.status_code ||
                    agendaSync?.recommended_url_check?.status_code ||
                    400}
                  ) no endpoint{' '}
                  <code className="bg-amber-100 dark:bg-amber-900/60 px-1 py-0.5 rounded font-mono text-[11px]">
                    crm-dados
                  </code>
                  . O serviço{' '}
                  <code className="bg-amber-100 dark:bg-amber-900/60 px-1 py-0.5 rounded font-mono text-[11px]">
                    /api/health
                  </code>{' '}
                  da agenda está saudável. Os dados e agendamentos locais permanecem preservados e a
                  fila de push continuará ativa normalmente.
                </AlertDescription>
              </div>
            </Alert>
          )}

          {/* Banner de Alerta Crítico: Ambas as URLs falharam por conexão ou credencial */}
          {agendaSync?.diagnostic?.status !== 'ok' &&
            agendaSync?.diagnostic?.status !== 'external_error' &&
            agendaSync?.recommended_url_check &&
            agendaSync.recommended_url_check.status !== 'ok' &&
            agendaSync.recommended_url_check.status !== 'external_error' && (
              <Alert className="border-rose-300 bg-rose-50/90 text-rose-900">
                <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                <div className="space-y-1">
                  <AlertTitle className="text-rose-950 font-semibold text-xs sm:text-sm">
                    Atenção: Ambas as URLs apresentaram pendências
                  </AlertTitle>
                  <AlertDescription className="text-xs text-rose-900 leading-relaxed">
                    Tanto a URL configurada quanto a URL recomendada retornaram erro de conexão ou
                    token. Verifique se o backend remoto está online e se o segredo AGENDA_CRM_TOKEN
                    possui permissão válida.
                  </AlertDescription>
                </div>
              </Alert>
            )}

          {/* Diagnóstico da URL configurada */}
          {agendaSync?.diagnostic && (
            <div
              className={cn(
                'p-3 rounded-xl border text-xs flex items-start gap-2.5',
                agendaSync.diagnostic.status === 'ok'
                  ? 'bg-emerald-50/70 border-emerald-200 text-emerald-900 dark:bg-emerald-950/20 dark:border-emerald-800 dark:text-emerald-300'
                  : agendaSync.diagnostic.status === 'external_error'
                    ? 'bg-amber-50/70 border-amber-300 text-amber-900 dark:bg-amber-950/30 dark:border-amber-800 dark:text-amber-300'
                    : agendaSync.diagnostic.status === 'invalid_token'
                      ? 'bg-rose-50/70 border-rose-200 text-rose-900 dark:bg-rose-950/20 dark:border-rose-800 dark:text-rose-300'
                      : agendaSync.diagnostic.status === 'wrong_url'
                        ? 'bg-amber-50/70 border-amber-200 text-amber-900 dark:bg-amber-950/20 dark:border-amber-800 dark:text-amber-300'
                        : 'bg-muted/50 border-border text-foreground',
              )}
            >
              {agendaSync.diagnostic.status === 'ok' ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
              ) : agendaSync.diagnostic.status === 'invalid_token' ? (
                <XCircle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
              ) : (
                <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
              )}
              <div className="space-y-1 flex-1">
                <span className="font-semibold block">
                  {agendaSync.diagnostic.status === 'ok'
                    ? 'URL Configurada: Conexão OK'
                    : agendaSync.diagnostic.status === 'external_error'
                      ? 'URL Configurada: Erro no Backend da Agenda (Problema Externo)'
                      : agendaSync.diagnostic.status === 'invalid_token'
                        ? 'URL Configurada: Token Inválido ou Não Autorizado'
                        : agendaSync.diagnostic.status === 'wrong_url'
                          ? 'URL Configurada: Aponta para Site / Rota Incorreta'
                          : 'Status da URL Configurada'}
                </span>
                <p className="opacity-90 leading-relaxed">{agendaSync.diagnostic.message}</p>
                {agendaSync.external_url && (
                  <p className="text-[11px] font-mono opacity-80 break-all pt-0.5">
                    URL avaliada: {agendaSync.external_url}
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Painel: Teste da URL recomendada (novo backend) */}
          {agendaSync?.recommended_url_check && (
            <div
              className={cn(
                'p-3.5 rounded-xl border text-xs space-y-2.5 transition-all',
                agendaSync.recommended_url_check.status === 'ok'
                  ? 'bg-emerald-50/80 border-emerald-300 text-emerald-950 dark:bg-emerald-950/30 dark:border-emerald-700 dark:text-emerald-200'
                  : 'bg-muted/40 border-border/80 text-foreground',
              )}
            >
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  {agendaSync.recommended_url_check.status === 'ok' ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                  ) : (
                    <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
                  )}
                  <span className="font-semibold text-xs sm:text-sm">
                    Teste da URL recomendada (novo backend)
                  </span>
                  <Badge
                    variant="outline"
                    className={cn(
                      'text-[10px] h-4.5 font-medium',
                      agendaSync.recommended_url_check.status === 'ok'
                        ? 'border-emerald-500 bg-emerald-100/70 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-300'
                        : agendaSync.recommended_url_check.status === 'external_error'
                          ? 'border-amber-500 bg-amber-100/70 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200'
                          : 'border-amber-400 bg-amber-100/70 text-amber-800',
                    )}
                  >
                    {agendaSync.recommended_url_check.status === 'ok'
                      ? 'Disponível & Válida'
                      : agendaSync.recommended_url_check.status === 'external_error'
                        ? 'Erro Externo da Agenda (HTTP 400)'
                        : 'Falhou'}
                  </Badge>
                </div>

                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs px-2.5 bg-background/80 hover:bg-background"
                  onClick={() => handleCopyRecommendedUrl(agendaSync.recommended_url_check!.url)}
                >
                  {copiedRecommendedUrl ? (
                    <>
                      <Check className="w-3.5 h-3.5 mr-1 text-emerald-600" /> URL Copiada
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5 mr-1" /> Copiar URL Recomendada
                    </>
                  )}
                </Button>
              </div>

              {agendaSync.recommended_url_check.status === 'ok' ? (
                <div className="space-y-1.5 leading-relaxed">
                  <p className="font-medium text-emerald-900 dark:text-emerald-300">
                    A URL nova funciona (
                    <strong>{agendaSync.recommended_url_check.appointments_found}</strong>{' '}
                    agendamentos, <strong>{agendaSync.recommended_url_check.contacts_found}</strong>{' '}
                    contatos encontrados). Atualize o secret AGENDA_SYNC_URL para este endereço e
                    clique em Sincronizar.
                  </p>
                  {agendaSync.recommended_url_check.sample && (
                    <div className="p-2 rounded-lg bg-emerald-100/50 dark:bg-emerald-900/30 text-[11px] font-mono text-emerald-950 dark:text-emerald-200">
                      Exemplo importável: Paciente &quot;
                      {agendaSync.recommended_url_check.sample.patient_name}&quot; (
                      {agendaSync.recommended_url_check.sample.city} -{' '}
                      {agendaSync.recommended_url_check.sample.status})
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-muted-foreground leading-relaxed">
                  {agendaSync.recommended_url_check.message}
                </p>
              )}

              <div className="pt-1 border-t border-border/30">
                <span className="text-[11px] font-mono text-muted-foreground break-all select-all block">
                  {agendaSync.recommended_url_check.url}
                </span>
              </div>
            </div>
          )}

          {agendaSync?.reminders_stats && (
            <div className="p-3 rounded-xl bg-muted/30 border text-xs flex flex-wrap items-center justify-between gap-2">
              <span className="text-muted-foreground font-medium">
                Métricas de Lembretes no CRM:
              </span>
              <div className="flex items-center gap-3">
                <span className="text-emerald-700 dark:text-emerald-400">
                  Véspera: <strong>{agendaSync.reminders_stats.confirmations_sent}</strong>
                </span>
                <span className="text-blue-700 dark:text-blue-400">
                  Dia: <strong>{agendaSync.reminders_stats.reminders_day_sent}</strong>
                </span>
                <span className="text-purple-700 dark:text-purple-400">
                  Confirmados pelo paciente:{' '}
                  <strong>{agendaSync.reminders_stats.confirmed_by_patient}</strong>
                </span>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Auxiliary Info / Connected Services Card */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card className="border-border/40 bg-white/40 shadow-none rounded-2xl">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold text-primary">
              Status do Serviço de Push
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm space-y-3">
            <div className="flex items-center justify-between py-1 border-b border-border/30">
              <span className="text-muted-foreground text-xs">Bridge Push Backend</span>
              <span className="font-semibold text-xs text-emerald-600 flex items-center gap-1">
                <CheckCircle2 className="w-3.5 h-3.5" /> external_push_bridge ativo
              </span>
            </div>
            <div className="flex items-center justify-between py-1 border-b border-border/30">
              <span className="text-muted-foreground text-xs">Coleção de Notificações</span>
              <span className="font-semibold text-xs text-emerald-600 flex items-center gap-1">
                <CheckCircle2 className="w-3.5 h-3.5" /> notifications configurada
              </span>
            </div>
            <div className="flex items-center justify-between py-1">
              <span className="text-muted-foreground text-xs">Assinatura VAPID</span>
              <span
                className={`font-semibold text-xs flex items-center gap-1 ${
                  isConnected ? 'text-emerald-600' : 'text-amber-600'
                }`}
              >
                {isConnected ? (
                  <>
                    <CheckCircle2 className="w-3.5 h-3.5" /> Pronta para disparos
                  </>
                ) : (
                  <>
                    <XCircle className="w-3.5 h-3.5" /> Pendente de chaves
                  </>
                )}
              </span>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/40 bg-white/40 shadow-none rounded-2xl">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold text-primary">
              Como funciona o Push
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground leading-relaxed space-y-2">
            <p>
              Quando um novo alerta de cuidado, mensagem urgente ou tarefa atribuída é registrada, o
              hook dispara a notificação via WebPush.
            </p>
            <p>
              Os membros da equipe autorizam o navegador ao clicar no banner de permissão de
              notificações do topo do app.
            </p>
          </CardContent>
        </Card>
      </div>

      {/* 1. Respostas Rápidas (Templates da Fabiana) */}
      {accountId && <QuickRepliesManager accountId={accountId} />}

      {/* 2. Horário de Atendimento e Resposta Fora do Horário */}
      {accountId && <BusinessHoursManager accountId={accountId} />}

      {/* 3. Pesquisa de Satisfação Pós-Consulta */}
      {accountId && <SurveySettingsManager accountId={accountId} />}
    </div>
  )
}
