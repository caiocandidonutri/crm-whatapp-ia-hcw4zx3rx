import React, { useState, useEffect, useRef } from 'react'
import { useInstanciaAtiva, useConversas, useMensagens } from '@/hooks/use-whatsapp'
import {
  conversationsToChats,
  whatsappMessagesToMessages,
  isInvalidContactName,
} from '@/lib/whatsapp-mappers'
import { ChatList } from '@/components/chat/ChatList'
import { ChatArea } from '@/components/chat/ChatArea'
import { ImportProgressBanner } from '@/components/chat/ImportProgressBanner'
import { useIsMobile } from '@/hooks/use-mobile'
import {
  MessageSquare,
  QrCode,
  Loader2,
  Copy,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  History,
  Trash2,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { useQrConnection } from '@/hooks/use-qr-connection'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import { toast } from 'sonner'
import {
  diagnosticarWebhook,
  enviarTexto,
  enviarMidia,
  reimportarHistorico,
  sincronizarConversa,
  factoryReset,
  arquivarConversa,
  type SyncPeriod,
} from '@/services/whatsapp_service'
import { Input } from '@/components/ui/input'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '@/hooks/use-auth'
import { useCurrentAccount } from '@/hooks/use-current-account'
import { useHistorySync } from '@/hooks/use-history-sync'
import { useCrmContatos } from '@/hooks/use-crm'

export default function Conversas() {
  const isMobile = useIsMobile()
  const { instance, loading: loadingInstance } = useInstanciaAtiva()
  const isImportingHistory = instance?.is_importing_history === true
  const [showArchived, setShowArchived] = useState(false)
  const {
    conversations,
    loading: loadingChats,
    loadingMore: loadingMoreChats,
    reload: reloadChats,
  } = useConversas(
    instance?.status === 'connected' ? instance.instance_name : undefined,
    isImportingHistory,
    showArchived,
  )
  const [activeChatId, setActiveChatId] = useState<string | null>(null)

  // Contatos do CRM da instância ativa: quando uma conversa tem um contato
  // no CRM, o nome salvo no CRM tem prioridade sobre o nome do WhatsApp
  // (tanto na lista quanto no cabeçalho da conversa).
  const { contacts: crmContacts } = useCrmContatos(
    instance?.status === 'connected' ? instance.instance_name : undefined,
  )
  const crmNameByJid = React.useMemo(() => {
    const map = new Map<string, string>()
    for (const c of crmContacts) {
      if (!isInvalidContactName(c.contact_name)) {
        map.set(c.jid, (c.contact_name as string).trim())
      }
    }
    return map
  }, [crmContacts])

  const {
    qrCodeBase64,
    isGenerating,
    pollErrors,
    rawState,
    connectingSince,
    generateQrCode,
    disconnect,
  } = useQrConnection(undefined, instance)

  // Rastreia se rawState passou por 'qrcode' nesta sessão.
  // Usado para distinguir "boot noise" da Evolution API (que retorna
  // state='connecting' antes do QR estar pronto) de um "connecting"
  // legítimo pós-escaneamento.
  const hadQrcodeStateRef = useRef(false)
  useEffect(() => {
    if (rawState === 'qrcode') {
      hadQrcodeStateRef.current = true
    } else if (rawState === null) {
      // Reset ao desconectar totalmente
      hadQrcodeStateRef.current = false
    }
  }, [rawState])

  const [isDiagnosing, setIsDiagnosing] = useState(false)
  const [isTimeout, setIsTimeout] = useState(false)
  const [isReimportConfirmOpen, setIsReimportConfirmOpen] = useState(false)
  const [isReimporting, setIsReimporting] = useState(false)
  const [reimportPeriod, setReimportPeriod] = useState<SyncPeriod>(7)
  const [isResetConfirmOpen, setIsResetConfirmOpen] = useState(false)
  const [isResetting, setIsResetting] = useState(false)
  const [resetConfirmText, setResetConfirmText] = useState('')
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const { signOut } = useAuth()
  const { role } = useCurrentAccount()

  const [highlightMsgId, setHighlightMsgId] = useState<string | null>(null)

  useEffect(() => {
    const chatParam = searchParams.get('chat')
    const msgParam = searchParams.get('msg')
    if (chatParam) {
      setActiveChatId(chatParam)
      if (msgParam) {
        setHighlightMsgId(msgParam)
      }
      setSearchParams({}, { replace: true })
    }
  }, [searchParams, setSearchParams])

  useEffect(() => {
    if (connectingSince) {
      const elapsed = Date.now() - connectingSince
      if (elapsed >= 60000) {
        setIsTimeout(true)
      } else {
        setIsTimeout(false)
        const timer = setTimeout(() => setIsTimeout(true), 60000 - elapsed)
        return () => clearTimeout(timer)
      }
    } else {
      setIsTimeout(false)
    }
  }, [connectingSince])

  const [diagnosticResult, setDiagnosticResult] = useState<any | null>(null)

  const handleDiagnose = async (instanceName: string) => {
    try {
      setIsDiagnosing(true)
      const result = await diagnosticarWebhook(instanceName)
      setDiagnosticResult(result)
    } catch (error: any) {
      toast.error('Erro ao diagnosticar webhook: ' + (error.message || 'Erro desconhecido'))
    } finally {
      setIsDiagnosing(false)
    }
  }

  const handleFactoryReset = async () => {
    if (resetConfirmText.trim().toUpperCase() !== 'APAGAR') return
    setIsResetting(true)
    try {
      await factoryReset()
      toast.success('Conta apagada. Crie um novo cadastro para começar.')
      signOut()
      navigate('/', { replace: true })
    } catch (error: any) {
      toast.error('Erro ao apagar conta: ' + (error.message || 'Erro desconhecido'))
      setIsResetting(false)
    }
  }

  const handleReimport = async () => {
    if (!instance?.instance_name) return
    try {
      setIsReimporting(true)
      await reimportarHistorico(instance.instance_name, reimportPeriod)
      setIsReimportConfirmOpen(false)
      const periodLabel =
        reimportPeriod === 0
          ? 'todo o histórico'
          : reimportPeriod === 1
            ? 'as últimas 24 horas'
            : `os últimos ${reimportPeriod} dias`
      toast.success(
        `Aparelho desconectado. Aponte o WhatsApp do celular no QR para reimportar ${periodLabel}.`,
      )
    } catch (error: any) {
      toast.error('Erro ao reimportar histórico: ' + (error.message || 'Erro desconhecido'))
    } finally {
      setIsReimporting(false)
    }
  }

  const diagnosticState = React.useMemo(() => {
    if (!diagnosticResult) return 'error'
    if (!diagnosticResult.matches || !diagnosticResult.expectedWebhookUrl) return 'error'

    const urlBefore =
      diagnosticResult.webhookBefore?.body?.url ||
      diagnosticResult.webhookBefore?.body?.webhook?.url
    const isBeforeCorrect = urlBefore === diagnosticResult.expectedWebhookUrl

    if (!isBeforeCorrect) return 'warning'
    if (diagnosticResult.webhookAfter?.statusCode === 200) return 'success'

    return 'error'
  }, [diagnosticResult])

  useEffect(() => {
    if (!loadingInstance && (!instance || instance.status !== 'connected')) {
      if (!qrCodeBase64 && !isGenerating && pollErrors === 0) {
        generateQrCode()
      }
    }
  }, [instance, loadingInstance, qrCodeBase64, isGenerating, pollErrors, generateQrCode])

  const activeConversation = React.useMemo(() => {
    return conversations.find((c) => c.id === activeChatId) || null
  }, [conversations, activeChatId])

  useHistorySync(activeConversation)

  const { messages: rawMessages = [] } = useMensagens(
    instance?.status === 'connected' ? instance.instance_name : undefined,
    activeConversation?.remote_jid,
    isImportingHistory,
  )

  const { readyConversations, pendingCount } = React.useMemo(() => {
    let pending = 0
    const ready: typeof conversations = []
    for (const c of conversations) {
      const isReady = (c.last_message_timestamp ?? 0) > 0 && !!c.last_message
      if (isReady) ready.push(c)
      else pending++
    }
    return { readyConversations: ready, pendingCount: pending }
  }, [conversations])

  const adaptedChats = React.useMemo(
    () =>
      conversationsToChats(readyConversations).map((chat) => {
        const crmName = crmNameByJid.get(chat.remote_jid)
        return crmName ? { ...chat, name: crmName } : chat
      }),
    [readyConversations, crmNameByJid],
  )

  const activeChatWithMessages = React.useMemo(() => {
    if (!activeConversation) return null
    const baseChat = conversationsToChats([activeConversation])[0]
    const crmName = crmNameByJid.get(baseChat.remote_jid)
    return {
      ...baseChat,
      ...(crmName ? { name: crmName } : {}),
      messages: whatsappMessagesToMessages(rawMessages),
    }
  }, [activeConversation, rawMessages, crmNameByJid])

  useEffect(() => {
    if (!isMobile && !activeChatId && readyConversations.length > 0) {
      setActiveChatId(readyConversations[0].id)
    }
  }, [isMobile, activeChatId, readyConversations])

  const handleSelectChat = (id: string) => {
    setActiveChatId(id)
    setHighlightMsgId(null)
  }

  const handleArchive = async (conversationId: string, archived: boolean) => {
    try {
      await arquivarConversa(conversationId, archived)
      if (activeChatId === conversationId && archived !== showArchived) {
        setActiveChatId(null)
      }
      toast.success(archived ? 'Conversa arquivada' : 'Conversa desarquivada')
    } catch (error: any) {
      toast.error('Erro ao arquivar: ' + (error.message || 'Erro desconhecido'))
    }
  }

  const handleSendMessage = async (text: string) => {
    if (!instance?.instance_name || !activeConversation?.remote_jid) {
      throw new Error('Instância não conectada ou conversa inválida')
    }
    try {
      await enviarTexto(instance.instance_name, activeConversation.remote_jid, text)
    } catch (error: any) {
      toast.error('Erro ao enviar mensagem: ' + (error.message || 'Erro desconhecido'))
      throw error
    }
  }

  const handleSendMedia = async (file: File, mediatype: string, caption?: string) => {
    if (!instance?.instance_name || !activeConversation?.remote_jid) {
      throw new Error('Instância não conectada ou conversa inválida')
    }
    try {
      await enviarMidia(
        instance.instance_name,
        activeConversation.remote_jid,
        file,
        mediatype,
        caption,
      )
    } catch (error: any) {
      toast.error('Erro ao enviar mídia: ' + (error.message || 'Erro desconhecido'))
      throw error
    }
  }

  const handleLoadOlder = async (): Promise<{ inserted: number; hasMore: boolean }> => {
    if (!instance?.instance_name || !activeConversation?.remote_jid) {
      return { inserted: 0, hasMore: false }
    }
    const oldestLocal = rawMessages.reduce((min, m) => {
      const ts = m.timestamp || 0
      if (ts > 0 && (min === 0 || ts < min)) return ts
      return min
    }, 0)
    if (oldestLocal === 0) return { inserted: 0, hasMore: false }

    try {
      const res = await sincronizarConversa(
        instance.instance_name,
        activeConversation.remote_jid,
        oldestLocal,
      )
      return {
        inserted: res.inserted || 0,
        hasMore: res.has_more !== false,
      }
    } catch {
      toast.error('Não foi possível carregar mensagens antigas.')
      return { inserted: 0, hasMore: false }
    }
  }

  if (loadingInstance) {
    return (
      <div className="h-[calc(100vh-8rem)] flex items-center justify-center">
        <Skeleton className="w-full h-full rounded-2xl" />
      </div>
    )
  }

  const isConnected = instance?.status === 'connected'

  // isConnecting só é verdadeiro se rawState JÁ passou por 'qrcode' nesta
  // sessão — garante que o boot noise da Evolution (state='connecting' antes
  // do QR estar pronto) não oculte a tela de QR prematuramente.
  const isConnecting = !isConnected && rawState === 'connecting' && hadQrcodeStateRef.current

  if (!instance || (!isConnected && !isConnecting)) {
    if (role !== 'owner') {
      return (
        <div className="h-[calc(100vh-8rem)] animate-fade-in flex items-center justify-center bg-background rounded-2xl shadow-elevation border border-border overflow-hidden">
          <div className="glass-card p-8 flex flex-col items-center justify-center text-center max-w-md w-full mx-4">
            <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center text-primary mb-6">
              <MessageSquare className="w-8 h-8" />
            </div>
            <h2 className="font-serif text-2xl font-semibold text-foreground mb-4">
              Aguardando WhatsApp da equipe
            </h2>
            <p className="text-sm text-muted-foreground text-balance">
              O administrador da conta precisa conectar um número de WhatsApp antes que você possa
              visualizar as conversas.
            </p>
          </div>
        </div>
      )
    }

    return (
      <div className="h-[calc(100vh-8rem)] animate-fade-in flex items-center justify-center bg-background rounded-2xl shadow-elevation border border-border overflow-hidden">
        <div className="glass-card p-8 flex flex-col items-center justify-center text-center max-w-md w-full mx-4">
          <div className="w-16 h-16 rounded-full bg-primary flex items-center justify-center text-white mb-6">
            <QrCode className="w-8 h-8" />
          </div>
          <h2 className="font-serif text-2xl font-semibold text-primary mb-4">
            Conecte seu WhatsApp
          </h2>
          <div className="w-64 h-64 bg-white rounded-xl border border-border flex items-center justify-center mb-6 overflow-hidden">
            {isGenerating ? (
              <div className="flex flex-col items-center justify-center space-y-4">
                <Loader2 className="w-10 h-10 animate-spin text-primary" />
                <p className="text-sm font-medium text-primary animate-pulse">Gerando código...</p>
              </div>
            ) : qrCodeBase64 ? (
              <img
                src={
                  qrCodeBase64.startsWith('data:')
                    ? qrCodeBase64
                    : `data:image/png;base64,${qrCodeBase64}`
                }
                alt="QR Code"
                className="w-56 h-56 object-contain mix-blend-multiply"
              />
            ) : pollErrors >= 5 ? (
              <div className="flex flex-col items-center justify-center space-y-4 p-4 text-center">
                <p className="text-sm text-destructive font-medium">Conexão instável</p>
                <Button variant="outline" onClick={generateQrCode}>
                  Tentar novamente
                </Button>
              </div>
            ) : (
              <QrCode className="w-16 h-16 text-muted-foreground/30" />
            )}
          </div>
          <p className="text-sm text-muted-foreground text-balance">
            Abra o WhatsApp no seu celular, acesse "Aparelhos Conectados" e aponte a câmera.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="h-[calc(100vh-8rem)] animate-fade-in flex flex-col bg-background rounded-2xl shadow-elevation border border-border overflow-hidden">
      <ImportProgressBanner instance={instance} />
      <div className="flex-1 flex min-h-0 overflow-hidden">
        <div
          className={cn(
            'w-full md:w-[380px] lg:w-[420px] shrink-0 transition-transform duration-300 ease-in-out flex flex-col',
            isMobile && activeChatId
              ? '-translate-x-full absolute h-full'
              : 'translate-x-0 relative',
          )}
        >
          <div className="flex-1 overflow-hidden relative flex flex-col">
            <ChatList
              chats={adaptedChats}
              activeChatId={activeChatId}
              onSelectChat={handleSelectChat}
              loading={loadingChats || isConnecting}
              pendingCount={pendingCount}
              loadingMore={loadingMoreChats}
              showArchived={showArchived}
              onToggleArchived={() => setShowArchived((v) => !v)}
              onRefresh={reloadChats}
              onReimportHistory={
                role === 'owner' ? () => setIsReimportConfirmOpen(true) : undefined
              }
              onDiagnose={
                role === 'owner' && instance
                  ? () => handleDiagnose(instance.instance_name)
                  : undefined
              }
              onDisconnect={
                role === 'owner' && instance ? () => disconnect(instance.instance_name) : undefined
              }
              onFactoryReset={role === 'owner' ? () => setIsResetConfirmOpen(true) : undefined}
            />
          </div>
        </div>
        <div
          className={cn(
            'flex-1 min-w-0 bg-[#f0f2f5] transition-transform duration-300 ease-in-out flex flex-col',
            isMobile && !activeChatId && !isConnecting
              ? 'translate-x-full absolute w-full h-full'
              : 'translate-x-0 relative w-full',
            !isMobile && !activeChatId && !isConnecting
              ? 'hidden md:flex items-center justify-center text-center p-8'
              : '',
          )}
        >
          {isConnecting && (
            <div
              className={cn(
                'w-full p-3 text-center text-sm font-medium flex items-center justify-center gap-2 shadow-sm shrink-0 z-20 transition-colors duration-300',
                isTimeout ? 'bg-red-500 text-white' : 'bg-yellow-500 text-yellow-950',
              )}
            >
              {isTimeout ? (
                <>
                  <AlertTriangle className="w-4 h-4" />
                  Falha ao estabilizar conexão.
                  <Button
                    variant="secondary"
                    size="sm"
                    className="ml-4 h-7 text-xs bg-white/20 hover:bg-white/30 text-white border-none"
                    onClick={() => disconnect(instance?.instance_name || '')}
                  >
                    Reconectar
                  </Button>
                </>
              ) : (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Estabilizando conexão com o WhatsApp... Aguarde alguns segundos.
                </>
              )}
            </div>
          )}

          <div
            className={cn(
              'flex-1 relative overflow-hidden flex flex-col',
              !activeChatId ? 'items-center justify-center' : '',
            )}
          >
            {activeChatWithMessages ? (
              <ChatArea
                chat={activeChatWithMessages}
                onBack={() => {
                  setActiveChatId(null)
                  setHighlightMsgId(null)
                }}
                onSendMessage={handleSendMessage}
                onSendMedia={handleSendMedia}
                onLoadOlder={handleLoadOlder}
                onArchive={(archived) => handleArchive(activeChatWithMessages.id, archived)}
                isArchived={activeConversation?.archived === true}
                isMobile={isMobile}
                highlightMsgId={highlightMsgId}
              />
            ) : (
              <div className="flex flex-col items-center justify-center h-full text-muted-foreground opacity-50 space-y-4">
                <div className="w-24 h-24 bg-border rounded-full flex items-center justify-center">
                  <MessageSquare className="w-12 h-12" />
                </div>
                <p className="text-xl font-medium">
                  {isConnecting
                    ? 'Aguardando sincronização...'
                    : 'Selecione uma conversa para começar'}
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      {isDiagnosing && (
        <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center">
          <div className="flex flex-col items-center gap-4 p-6 glass-card rounded-xl">
            <Loader2 className="w-10 h-10 animate-spin text-primary" />
            <p className="text-sm font-medium animate-pulse">Diagnosticando Webhook...</p>
          </div>
        </div>
      )}

      <Dialog
        open={isResetConfirmOpen}
        onOpenChange={(open) => !isResetting && setIsResetConfirmOpen(open)}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <Trash2 className="w-5 h-5" />
              Apagar conta e começar de novo
            </DialogTitle>
            <DialogDescription className="pt-2 space-y-2 text-sm">
              <span className="block">
                Esta ação <strong>não pode ser desfeita</strong>. Vamos apagar permanentemente:
              </span>
              <ul className="list-disc list-inside text-xs text-muted-foreground space-y-0.5 pl-1">
                <li>Sua sessão WhatsApp pareada</li>
                <li>Todas as conversas e mensagens importadas</li>
                <li>Todos os contatos do CRM</li>
                <li>Sua conta de usuário</li>
              </ul>
              <span className="block text-destructive bg-destructive/10 border border-destructive/20 rounded-md p-2 text-xs mt-2">
                Você precisará fazer um novo cadastro depois disso.
              </span>
            </DialogDescription>
          </DialogHeader>

          <div className="mt-2 space-y-2">
            <label className="text-xs font-semibold text-muted-foreground">
              Para confirmar, digite{' '}
              <span className="font-mono text-destructive font-bold">APAGAR</span>:
            </label>
            <Input
              value={resetConfirmText}
              onChange={(e) => setResetConfirmText(e.target.value)}
              disabled={isResetting}
              placeholder="APAGAR"
              className="font-mono"
              autoFocus
            />
          </div>

          <DialogFooter className="gap-2 sm:justify-end mt-4">
            <Button
              variant="ghost"
              onClick={() => setIsResetConfirmOpen(false)}
              disabled={isResetting}
              className="rounded-xl"
            >
              Cancelar
            </Button>
            <Button
              onClick={handleFactoryReset}
              disabled={isResetting || resetConfirmText.trim().toUpperCase() !== 'APAGAR'}
              variant="destructive"
              className="rounded-xl"
            >
              {isResetting ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Apagando...
                </>
              ) : (
                <>
                  <Trash2 className="w-4 h-4 mr-2" />
                  Apagar tudo
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={isReimportConfirmOpen}
        onOpenChange={(open) => !isReimporting && setIsReimportConfirmOpen(open)}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <History className="w-5 h-5 text-amber-600" />
              Reimportar histórico do WhatsApp
            </DialogTitle>
            <DialogDescription className="pt-2 space-y-2 text-sm">
              <span className="block">
                Vamos <strong>desconectar</strong> sua sessão atual e gerar um novo QR Code.
              </span>
              <span className="block">
                Ao reconectar pelo celular, o WhatsApp enviará o histórico do período escolhido
                abaixo.
              </span>
              <span className="block text-amber-700 bg-amber-50 border border-amber-200 rounded-md p-2 text-xs">
                ⚠ Períodos maiores levam mais tempo para sincronizar. Você pode usar o app
                normalmente enquanto isso.
              </span>
            </DialogDescription>
          </DialogHeader>

          <div className="mt-2 space-y-2">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Período da importação
            </label>
            <div className="grid grid-cols-3 gap-2">
              {(
                [
                  { value: 1 as SyncPeriod, label: '24 horas' },
                  { value: 7 as SyncPeriod, label: '7 dias' },
                  { value: 30 as SyncPeriod, label: '30 dias' },
                  { value: 90 as SyncPeriod, label: '90 dias' },
                  { value: 0 as SyncPeriod, label: 'Tudo' },
                ] as const
              ).map((opt) => {
                const active = reimportPeriod === opt.value
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setReimportPeriod(opt.value)}
                    disabled={isReimporting}
                    className={cn(
                      'px-3 py-2 rounded-lg border text-sm font-medium transition-all',
                      active
                        ? 'bg-amber-600 text-white border-amber-600 shadow-sm'
                        : 'bg-white border-border hover:border-amber-300 text-foreground/80',
                      isReimporting && 'opacity-50 cursor-not-allowed',
                    )}
                  >
                    {opt.label}
                  </button>
                )
              })}
            </div>
            <p className="text-[11px] text-muted-foreground">
              Recomendado: 7 dias (rápido e cobre conversas ativas).
            </p>
          </div>

          <DialogFooter className="gap-2 sm:justify-end mt-4">
            <Button
              variant="ghost"
              onClick={() => setIsReimportConfirmOpen(false)}
              disabled={isReimporting}
              className="rounded-xl"
            >
              Cancelar
            </Button>
            <Button
              onClick={handleReimport}
              disabled={isReimporting}
              className="rounded-xl bg-amber-600 hover:bg-amber-700"
            >
              {isReimporting ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Reimportando...
                </>
              ) : (
                <>
                  <History className="w-4 h-4 mr-2" />
                  Reimportar agora
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!diagnosticResult} onOpenChange={(open) => !open && setDiagnosticResult(null)}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Diagnóstico do Webhook</DialogTitle>
            <DialogDescription>
              Este é um diagnóstico técnico da conexão com a Evolution API. Compartilhe o conteúdo
              abaixo com o suporte se os problemas persistirem.
            </DialogDescription>
          </DialogHeader>

          {diagnosticResult && (
            <div className="space-y-4 flex-1 overflow-hidden flex flex-col">
              <div
                className={cn(
                  'p-4 rounded-lg border flex items-start gap-3 shrink-0',
                  diagnosticState === 'success' &&
                    'bg-green-500/10 border-green-500/20 text-green-700',
                  diagnosticState === 'warning' &&
                    'bg-yellow-500/10 border-yellow-500/20 text-yellow-700',
                  diagnosticState === 'error' && 'bg-red-500/10 border-red-500/20 text-red-700',
                )}
              >
                {diagnosticState === 'success' && (
                  <CheckCircle2 className="w-5 h-5 mt-0.5 shrink-0" />
                )}
                {diagnosticState === 'warning' && (
                  <AlertTriangle className="w-5 h-5 mt-0.5 shrink-0" />
                )}
                {diagnosticState === 'error' && <XCircle className="w-5 h-5 mt-0.5 shrink-0" />}

                <div>
                  <h4 className="font-semibold text-sm">
                    {diagnosticState === 'success' && 'Webhook configurado corretamente'}
                    {diagnosticState === 'warning' && 'Webhook reconfigurado com sucesso'}
                    {diagnosticState === 'error' && 'Não foi possível configurar o webhook'}
                  </h4>
                  <p className="text-xs opacity-90 mt-1">
                    {diagnosticState === 'success' &&
                      'O webhook está ativo e apontando para a URL correta.'}
                    {diagnosticState === 'warning' &&
                      'Aguarde alguns segundos e mande uma mensagem de teste para confirmar.'}
                    {diagnosticState === 'error' &&
                      'Houve uma falha na comunicação ou faltam configurações. Veja detalhes abaixo.'}
                  </p>
                </div>
              </div>

              <div className="relative flex-1 overflow-hidden rounded-md border bg-muted/50">
                <ScrollArea className="h-full w-full p-4">
                  <pre className="text-[11px] font-mono whitespace-pre-wrap break-all text-muted-foreground">
                    {JSON.stringify(diagnosticResult, null, 2)}
                  </pre>
                </ScrollArea>
                <Button
                  size="sm"
                  variant="secondary"
                  className="absolute top-2 right-2 h-7 opacity-70 hover:opacity-100"
                  onClick={() => {
                    navigator.clipboard.writeText(JSON.stringify(diagnosticResult, null, 2))
                    toast.success('Copiado para a área de transferência')
                  }}
                >
                  <Copy className="h-3 w-3 mr-1" /> Copiar
                </Button>
              </div>
            </div>
          )}

          <DialogFooter className="shrink-0">
            <DialogClose asChild>
              <Button variant="outline">Fechar</Button>
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
