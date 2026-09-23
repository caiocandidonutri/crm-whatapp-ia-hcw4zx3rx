import React, { useState, useEffect, useRef, useCallback } from 'react'
import { useInstanciaAtiva, useConversas, useMensagens } from '@/hooks/use-whatsapp'
import {
  conversationsToChats,
  whatsappMessagesToMessages,
  isInvalidContactName,
} from '@/lib/whatsapp-mappers'
import { ChatList } from '@/components/chat/ChatList'
import { ChatArea } from '@/components/chat/ChatArea'
import { ImportProgressBanner } from '@/components/chat/ImportProgressBanner'
import { AutoRecoveryNotice } from '@/components/chat/AutoRecoveryNotice'
import { DiagnosticModal } from '@/components/chat/DiagnosticModal'
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
import { searchMessageContent } from '@/services/message-search'
import { Input } from '@/components/ui/input'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '@/hooks/use-auth'
import { useCurrentAccount } from '@/hooks/use-current-account'
import { useHistorySync } from '@/hooks/use-history-sync'
import { useCrmContatos } from '@/hooks/use-crm'
import pb from '@/lib/pocketbase/client'

import { useRealtimeStatus } from '@/hooks/use-realtime-status'

export default function Conversas() {
  const isMobile = useIsMobile()
  const { instance, loading: loadingInstance } = useInstanciaAtiva()
  const isImportingHistory = instance?.is_importing_history === true
  const [showArchived, setShowArchived] = useState(false)
  const realtimeStatus = useRealtimeStatus()
  const lastRealtimeEventTimeRef = useRef<number>(Date.now())

  const {
    conversations,
    setConversations,
    loading: loadingChats,
    loadingMore: loadingMoreChats,
    reload: reloadChats,
  } = useConversas(
    instance?.status === 'connected' ? instance.instance_name : undefined,
    isImportingHistory,
    showArchived,
  )
  const [activeChatId, setActiveChatId] = useState<string | null>(null)
  const clearingUnreadRef = useRef<Set<string>>(new Set())

  // Zerar unread_count de forma idempotente local e no PocketBase
  const markChatAsRead = useCallback(
    (convIdOrJid: string) => {
      const conv = conversations.find((c) => c.id === convIdOrJid || c.remote_jid === convIdOrJid)
      if (!conv || !conv.unread_count || conv.unread_count <= 0) return
      if (clearingUnreadRef.current.has(conv.id)) return

      clearingUnreadRef.current.add(conv.id)
      // Atualiza localmente no objeto
      conv.unread_count = 0

      // Dispara re-render da lista de conversas com unread_count = 0
      setConversations((prev) =>
        prev.map((c) => (c.id === conv.id ? { ...c, unread_count: 0 } : c)),
      )

      // Persiste no backend de forma assíncrona
      pb.collection('conversations')
        .update(conv.id, { unread_count: 0 })
        .catch((err) => {
          console.warn('Falha ao zerar unread_count:', err)
        })
        .finally(() => {
          clearingUnreadRef.current.delete(conv.id)
        })
    },
    [conversations],
  )

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
    resetErrors,
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
  const { user, signOut } = useAuth()
  const { role, accountId } = useCurrentAccount()

  const [highlightMsgId, setHighlightMsgId] = useState<string | null>(null)

  const [messageMatchJids, setMessageMatchJids] = useState<Set<string>>(new Set())
  const [messageMatchPreviews, setMessageMatchPreviews] = useState<Map<string, string>>(new Map())
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleSearchChange = useCallback(
    (term: string) => {
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current)
      if (!term.trim() || !instance?.instance_name || !accountId) {
        setMessageMatchJids(new Set())
        setMessageMatchPreviews(new Map())
        return
      }
      searchDebounceRef.current = setTimeout(async () => {
        try {
          const result = await searchMessageContent(instance.instance_name, accountId, term)
          setMessageMatchJids(result.jids)
          setMessageMatchPreviews(result.previewByJid)
        } catch {
          // ignore
        }
      }, 400)
    },
    [instance?.instance_name, accountId],
  )

  useEffect(() => {
    const chatParam = searchParams.get('chat')
    const convParam = searchParams.get('conversation_id')
    const phoneParam = searchParams.get('phone')
    const msgParam = searchParams.get('msg')

    const targetChat = chatParam || convParam
    if (targetChat) {
      setActiveChatId(targetChat)
      if (msgParam) {
        setHighlightMsgId(msgParam)
      }
      setSearchParams({}, { replace: true })
      return
    }

    if (phoneParam && conversations.length > 0) {
      const cleanTargetPhone = phoneParam.replace(/\D/g, '')
      const matched = conversations.find((c) => {
        const cPhone = (
          c.contact_phone || (c.remote_jid ? c.remote_jid.split('@')[0] : '')
        ).replace(/\D/g, '')
        return (
          cPhone.endsWith(cleanTargetPhone.slice(-8)) || cleanTargetPhone.endsWith(cPhone.slice(-8))
        )
      })
      if (matched) {
        setActiveChatId(matched.id)
        setSearchParams({}, { replace: true })
      }
    }
  }, [searchParams, setSearchParams, conversations])

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

  useEffect(() => {
    if (!loadingInstance && (!instance || instance.status !== 'connected')) {
      if (!qrCodeBase64 && !isGenerating && pollErrors === 0) {
        generateQrCode()
      }
    }
  }, [instance, loadingInstance, qrCodeBase64, isGenerating, pollErrors, generateQrCode])

  const activeConversation = React.useMemo(() => {
    return conversations.find((c) => c.id === activeChatId || c.remote_jid === activeChatId) || null
  }, [conversations, activeChatId])

  useHistorySync(activeConversation)

  const {
    messages: rawMessages = [],
    setMessages: setRawMessages,
    hasMoreOlder: hasMoreOlderMessages,
    loadingOlder: loadingOlderMessages,
    loadOlderMessages: loadOlderMessagesFn,
    reload: reloadMensagens,
  } = useMensagens(
    instance?.status === 'connected' ? instance.instance_name : undefined,
    activeConversation?.remote_jid,
    isImportingHistory,
  )

  // Escuta qualquer evento de realtime para atualizar a marca de tempo de saúde do SSE
  useEffect(() => {
    let cancelled = false
    let unsubPromise: Promise<() => Promise<void>> | undefined
    try {
      unsubPromise = pb.realtime.subscribe('*', () => {
        if (!cancelled) {
          lastRealtimeEventTimeRef.current = Date.now()
        }
      })
      unsubPromise?.catch((err) => {
        if (import.meta.env.DEV) {
          console.debug('[Conversas] Falha ao assinar realtime wildcard:', err?.message || err)
        }
      })
    } catch (err: any) {
      if (import.meta.env.DEV) {
        console.debug('[Conversas] Exceção ao assinar realtime wildcard:', err?.message || err)
      }
    }
    return () => {
      cancelled = true
      if (unsubPromise) {
        unsubPromise
          .then((fn) => {
            if (typeof fn === 'function') {
              return fn()
            }
          })
          .catch(() => {})
      }
    }
  }, [])

  // Frente 1: Polling de segurança leve: timer de ~20s que só refetch se a aba
  // estiver ativa E nenhum evento SSE tenha chegado nos últimos ~30s.
  useEffect(() => {
    if (!instance || instance.status !== 'connected') return

    const interval = setInterval(() => {
      if (document.visibilityState !== 'visible') return
      const idle = Date.now() - lastRealtimeEventTimeRef.current
      if (idle >= 30000) {
        // SSE inativo há pelo menos 30s: refetch leve
        reloadChats()
        if (activeConversation?.remote_jid) {
          reloadMensagens()
        }
        lastRealtimeEventTimeRef.current = Date.now()
      }
    }, 20000)

    return () => clearInterval(interval)
  }, [instance, reloadChats, reloadMensagens, activeConversation?.remote_jid])

  const adaptedChats = React.useMemo(
    () =>
      conversationsToChats(conversations).map((chat) => {
        const crmName = crmNameByJid.get(chat.remote_jid)
        return crmName ? { ...chat, name: crmName } : chat
      }),
    [crmNameByJid],
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
    if (!isMobile && !activeChatId && conversations.length > 0) {
      setActiveChatId(conversations[0].id)
      markChatAsRead(conversations[0].id)
    }
  }, [isMobile, activeChatId, conversations, markChatAsRead])

  // Efeito adicional para zerar unread_count se o activeChatId mudar ou se novas mensagens chegarem na conversa ativa
  useEffect(() => {
    if (activeChatId) {
      markChatAsRead(activeChatId)
    }
  }, [activeChatId, markChatAsRead])

  const handleSelectChat = useCallback(
    (id: string) => {
      setActiveChatId(id)
      setHighlightMsgId(null)
      markChatAsRead(id)
    },
    [markChatAsRead],
  )

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

    const optimisticId = `optimistic_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`
    const nowUnix = Math.floor(Date.now() / 1000)

    // Atualização otimista: insere a mensagem imediatamente na lista do chat
    const optimisticMessage: any = {
      id: optimisticId,
      user_id: user?.id || '',
      account_id: accountId || '',
      instance_name: instance.instance_name,
      remote_jid: activeConversation.remote_jid,
      from_me: true,
      content: text,
      message_type: 'conversation',
      status: 'pending',
      timestamp: nowUnix,
      created: new Date().toISOString(),
      updated: new Date().toISOString(),
      collectionId: '',
      collectionName: 'whatsapp_messages',
    }

    setRawMessages((prev) => [...prev, optimisticMessage])

    // Atualiza otimista também o snippet da conversa
    setConversations((prev) =>
      prev.map((c) =>
        c.id === activeConversation.id || c.remote_jid === activeConversation.remote_jid
          ? { ...c, last_message: text, last_message_timestamp: nowUnix }
          : c,
      ),
    )

    try {
      const res = await enviarTexto(instance.instance_name, activeConversation.remote_jid, text)
      // Reconcilia a mensagem otimista com o registro real retornado pelo servidor
      if (res && res.message) {
        const savedMsg = res.message
        setRawMessages((prev) => {
          // Substitui o otimista pelo real, evitando duplicatas se o SSE já tiver entregue
          const existsReal = prev.some(
            (m) =>
              m.id === savedMsg.id || (savedMsg.message_id && m.message_id === savedMsg.message_id),
          )
          if (existsReal) {
            return prev.filter((m) => m.id !== optimisticId)
          }
          return prev.map((m) => (m.id === optimisticId ? savedMsg : m))
        })
      }
    } catch (err) {
      // Em caso de falha, marca a mensagem otimista como falha
      setRawMessages((prev) =>
        prev.map((m) => (m.id === optimisticId ? { ...m, status: 'failed' } : m)),
      )
      throw err
    }
  }

  const handleSendMedia = async (file: File, mediatype: string, caption?: string) => {
    if (!instance?.instance_name || !activeConversation?.remote_jid) {
      throw new Error('Instância não conectada ou conversa inválida')
    }

    const optimisticId = `optimistic_media_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`
    const nowUnix = Math.floor(Date.now() / 1000)

    const optimisticMessage: any = {
      id: optimisticId,
      user_id: user?.id || '',
      account_id: accountId || '',
      instance_name: instance.instance_name,
      remote_jid: activeConversation.remote_jid,
      from_me: true,
      content: caption || '',
      message_type: mediatype,
      status: 'pending',
      timestamp: nowUnix,
      media_filename: file.name,
      media_mimetype: file.type,
      created: new Date().toISOString(),
      updated: new Date().toISOString(),
      collectionId: '',
      collectionName: 'whatsapp_messages',
    }

    setRawMessages((prev) => [...prev, optimisticMessage])

    try {
      const res = await enviarMidia(
        instance.instance_name,
        activeConversation.remote_jid,
        file,
        mediatype,
        caption,
      )
      if (res && res.message) {
        const savedMsg = res.message
        setRawMessages((prev) => {
          const existsReal = prev.some(
            (m) =>
              m.id === savedMsg.id || (savedMsg.message_id && m.message_id === savedMsg.message_id),
          )
          if (existsReal) {
            return prev.filter((m) => m.id !== optimisticId)
          }
          return prev.map((m) => (m.id === optimisticId ? savedMsg : m))
        })
      }
    } catch (error: any) {
      setRawMessages((prev) =>
        prev.map((m) => (m.id === optimisticId ? { ...m, status: 'failed' } : m)),
      )
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
                <Button
                  variant="outline"
                  onClick={() => {
                    resetErrors?.()
                    generateQrCode()
                  }}
                >
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
      <AutoRecoveryNotice instance={instance} />
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
              onSearchChange={handleSearchChange}
              messageMatchJids={messageMatchJids}
              messageMatchPreviews={messageMatchPreviews}
              realtimeStatus={realtimeStatus}
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
                <span className="inline-flex items-center gap-2">
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
                </span>
              ) : (
                <span className="inline-flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Estabilizando conexão com o WhatsApp... Aguarde alguns segundos.
                </span>
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
                hasMoreOlderDb={hasMoreOlderMessages}
                loadingOlderDb={loadingOlderMessages}
                onLoadOlderDb={loadOlderMessagesFn}
                onArchive={(archived) => handleArchive(activeChatWithMessages.id, archived)}
                isArchived={activeConversation?.archived === true}
                isMobile={isMobile}
                highlightMsgId={highlightMsgId}
                conversations={conversations}
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
                <span className="inline-flex items-center">
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Apagando...
                </span>
              ) : (
                <span className="inline-flex items-center">
                  <Trash2 className="w-4 h-4 mr-2" />
                  Apagar tudo
                </span>
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
                <span className="inline-flex items-center">
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Reimportando...
                </span>
              ) : (
                <span className="inline-flex items-center">
                  <History className="w-4 h-4 mr-2" />
                  Reimportar agora
                </span>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <DiagnosticModal result={diagnosticResult} onClose={() => setDiagnosticResult(null)} />
    </div>
  )
}
