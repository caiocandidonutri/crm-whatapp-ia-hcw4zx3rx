import React, { useState, useRef, useEffect, useLayoutEffect, useCallback } from 'react'
import {
  ArrowLeft,
  MoreVertical,
  Paperclip,
  Smile,
  Send,
  Image as ImageIcon,
  FileText,
  Mic,
  Loader2,
  Trash2,
  Check,
  Pencil,
  AlertCircle,
  X,
  HeartPulse,
} from 'lucide-react'
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert'
import { getErrorMessage } from '@/lib/pocketbase/errors'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Input } from '@/components/ui/input'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  alternarArquivamentoConversa,
  atualizarNomeContato,
  enviarTexto,
  transcreverAudio,
} from '@/services/whatsapp_service'
import { isInvalidContactName } from '@/lib/whatsapp-mappers'
import { resolveDisplayName, formatPhoneBR } from '@/lib/phone'
import { AddToCrmDialog } from '@/components/crm/AddToCrmDialog'
import { ForwardDialog } from '@/components/chat/ForwardDialog'
import { PatientContextPanel } from '@/components/chat/PatientContextPanel'
import { UserCheck } from 'lucide-react'
import { AgenteConversaToggle } from '@/components/chat/AgenteConversaToggle'
import { TaskActionBar } from '@/components/chat/TaskActionBar'
import { TaskFormDialog } from '@/components/chat/TaskFormDialog'
import { TaskViewDialog } from '@/components/chat/TaskViewDialog'
import { MessageItem } from '@/components/chat/MessageItem'
import { LazyMediaPreview } from '@/components/chat/MessageMedia'
import { CareSecretarySheet, type CareContactContext } from '@/components/CareSecretarySheet'
import pb from '@/lib/pocketbase/client'
import { getTasks } from '@/services/tasks'
import { getCrmContactByJid } from '@/services/crm_service'
import { getDayKeySaoPaulo, getChatDateSeparatorLabel } from '@/lib/datetime'
import { Task, CrmContact } from '@/types/models'
import { useRealtime } from '@/hooks/use-realtime'
import { CategoryPicker } from '@/components/categories/CategoryPicker'
import { TemplatePicker } from '@/components/chat/TemplatePicker'
import { MessageTemplatesSection } from '@/components/crm/MessageTemplatesSection'
import { useCategories } from '@/hooks/use-categories'
import { useCurrentAccount } from '@/hooks/use-current-account'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { toast } from 'sonner'
type ChatAreaProps = {
  chat: any
  onBack: () => void
  onSendMessage?: (text: string) => Promise<void>
  onSendMedia?: (file: File, mediatype: string, caption?: string) => Promise<void>
  /** Dispara busca por mensagens anteriores ao timestamp da mais antiga local.
   *  Retorna inserted (quantas foram efetivamente salvas) e hasMore (se a
   *  Evolution ainda tem mais antigas além desse batch). O botão é
   *  desligado APENAS quando hasMore=false — não quando inserted=0
   *  (que pode ser só dedup de msgs já conhecidas localmente). */
  onLoadOlder?: () => Promise<{ inserted: number; hasMore: boolean }>
  isMobile: boolean
  highlightMsgId?: string | null
  /** Há mensagens mais antigas no banco ainda não carregadas na memória
   *  (paginação DB do useMensagens). Quando true, mostra um botão extra
   *  "Carregar mais antigas" no topo da conversa que dispara onLoadOlderDb. */
  hasMoreOlderDb?: boolean
  loadingOlderDb?: boolean
  onLoadOlderDb?: () => void
  onArchive?: (archived: boolean) => Promise<void> | void
  isArchived?: boolean
  conversations?: any[]
}

export function ChatArea({
  chat,
  onBack,
  onSendMessage,
  onSendMedia,
  onLoadOlder,
  isMobile,
  highlightMsgId,
  hasMoreOlderDb,
  loadingOlderDb,
  onLoadOlderDb,
  onArchive,
  isArchived,
  conversations = [],
}: ChatAreaProps) {
  const [inputText, setInputText] = useState('')
  const [isSending, setIsSending] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
  const [mediaModalOpen, setMediaModalOpen] = useState(false)
  const [selectedMedia, setSelectedMedia] = useState<{
    url: string
    type: string
    mimetype?: string
    name?: string
  } | null>(null)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const [sendMediaModalOpen, setSendMediaModalOpen] = useState(false)
  const [mediaFile, setMediaFile] = useState<File | null>(null)
  const [mediaPreviewUrl, setMediaPreviewUrl] = useState<string | null>(null)
  const [mediaCaption, setMediaCaption] = useState('')
  const [selectedMediaType, setSelectedMediaType] = useState<
    'image' | 'video' | 'document' | 'audio' | null
  >(null)

  const [isTemplateManageOpen, setIsTemplateManageOpen] = useState(false)

  const messagesEndRef = useRef<HTMLDivElement>(null)

  const [isInCrm, setIsInCrm] = useState(false)
  const [isAddingCrm, setIsAddingCrm] = useState(false)
  // Dialog de pré-validação ao adicionar no CRM. Substitui o save direto
  // — agora o user revisa nome, vincula empresa, define cargo/email/stage
  // antes de criar o registro.
  const [isAddCrmDialogOpen, setIsAddCrmDialogOpen] = useState(false)

  // Diálogo de "Editar nome do contato". Útil pra convs onde o nome
  // chegou vazio do Baileys ou ficou corrompido em estados antigos do
  // banco. Persiste em conversations.contact_name + crm_contacts (via
  // endpoint que sincroniza os dois).
  const [isEditNameOpen, setIsEditNameOpen] = useState(false)
  const [editNameValue, setEditNameValue] = useState('')
  const [isSavingName, setIsSavingName] = useState(false)

  const handleSaveContactName = async () => {
    if (!chat?.instance_name || !chat?.remote_jid) return
    setIsSavingName(true)
    try {
      await atualizarNomeContato(chat.instance_name, chat.remote_jid, editNameValue.trim())
      toast.success('Nome do contato atualizado')
      setIsEditNameOpen(false)
    } catch (err: any) {
      toast.error('Erro ao salvar: ' + (err?.message || 'tente novamente'))
    } finally {
      setIsSavingName(false)
    }
  }

  // Estado do "Carregar mais antigas"
  const [isLoadingOlder, setIsLoadingOlder] = useState(false)
  const [hasMoreOlder, setHasMoreOlder] = useState(true)

  // Secretária de Cuidado aberta a partir da conversa do WhatsApp.
  // Buscamos o crm_contacts pelo jid pra preencher o contexto (stage,
  // care_status, converted_at, id). Se não houver contato no CRM,
  // abrimos mesmo assim com os dados básicos do chat.
  const [careSheetOpen, setCareSheetOpen] = useState(false)
  const [careContactContext, setCareContactContext] = useState<CareContactContext | null>(null)
  const [crmContactForChat, setCrmContactForChat] = useState<CrmContact | null>(null)

  useEffect(() => {
    if (!chat?.remote_jid || !chat?.instance_name || chat?.type === 'group') {
      setCrmContactForChat(null)
      return
    }
    let cancelled = false
    getCrmContactByJid(chat.instance_name, chat.remote_jid)
      .then((c) => {
        if (!cancelled) setCrmContactForChat(c)
      })
      .catch(() => {
        if (!cancelled) setCrmContactForChat(null)
      })
    return () => {
      cancelled = true
    }
  }, [chat?.remote_jid, chat?.instance_name, chat?.type])

  const handleOpenCareSecretary = () => {
    const ctx: CareContactContext = {
      name: chat?.name || 'Contato',
      phone: chat?.phone || undefined,
      jid: chat?.remote_jid || undefined,
      contactId: crmContactForChat?.id,
      stage: crmContactForChat?.stage || undefined,
      careStatus: crmContactForChat?.care_status || undefined,
      lastConsultationAt: crmContactForChat?.converted_at || undefined,
      aiSuggestedAction: crmContactForChat?.ai_suggested_action || undefined,
    }
    setCareContactContext(ctx)
    setCareSheetOpen(true)
  }

  const [localHighlight, setLocalHighlight] = useState<string | null>(null)
  const processedHighlightRef = useRef<string | null>(null)

  useEffect(() => {
    if (
      highlightMsgId &&
      highlightMsgId !== processedHighlightRef.current &&
      chat?.messages?.length > 0
    ) {
      const timer = setTimeout(() => {
        const el = document.querySelector(`[data-message-id="${highlightMsgId}"]`)
        processedHighlightRef.current = highlightMsgId
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' })
          setLocalHighlight(highlightMsgId)
          setTimeout(() => setLocalHighlight(null), 2500)
        } else {
          toast.info('Mensagem no histórico antigo', {
            description: 'Use o botão "Carregar mensagens mais antigas" para procurá-la.',
          })
        }
      }, 150)
      return () => clearTimeout(timer)
    }
  }, [highlightMsgId, chat?.messages])

  // Seleção de mensagens
  const [selectedMessages, setSelectedMessages] = useState<Set<string>>(new Set())
  const isSelectionMode = selectedMessages.size > 0

  const toggleSelection = useCallback((id: string) => {
    setSelectedMessages((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const clearSelection = useCallback(() => {
    setSelectedMessages(new Set())
  }, [])

  // Task modal state
  const [isTaskModalOpen, setIsTaskModalOpen] = useState(false)
  const selectedMessagesArray = React.useMemo(() => {
    if (!chat?.messages) return []
    return chat.messages.filter((m: any) => selectedMessages.has(m.id))
  }, [chat?.messages, selectedMessages])

  const [tasks, setTasks] = useState<Task[]>([])
  const { account } = useCurrentAccount()
  const { categories } = useCategories(account?.id)

  useEffect(() => {
    if (!chat?.id) return
    const fetchTasks = async () => {
      try {
        const data = await getTasks(`conversation_id = '${chat.id}'`)
        setTasks(data)
      } catch (err) {
        // Ignorado no UI para não poluir
      }
    }
    fetchTasks()
  }, [chat?.id])

  useRealtime<Task>(
    'tasks',
    (e) => {
      if (e.action === 'create') {
        if (e.record.conversation_id === chat?.id) {
          setTasks((prev) => {
            const exists = prev.some((t) => t.id === e.record.id)
            if (exists) return prev
            return [...prev, e.record]
          })
        }
      } else if (e.action === 'update') {
        setTasks((prev) => prev.map((t) => (t.id === e.record.id ? e.record : t)))
      } else if (e.action === 'delete') {
        setTasks((prev) => prev.filter((t) => t.id !== e.record.id))
      }
    },
    !!chat?.id,
  )

  const tasksByMessageId = React.useMemo(() => {
    const map = new Map<string, Task[]>()
    for (const task of tasks) {
      if (task.linked_message_ids) {
        for (const msgId of task.linked_message_ids) {
          if (!map.has(msgId)) map.set(msgId, [])
          map.get(msgId)!.push(task)
        }
      }
    }
    return map
  }, [tasks])

  const [taskViewMessageId, setTaskViewMessageId] = useState<string | null>(null)
  const taskViewTasks = taskViewMessageId ? tasksByMessageId.get(taskViewMessageId) || [] : []

  // Estados de Encaminhar / Responder / Contexto de Paciente / Transcrição
  const [forwardModalOpen, setForwardModalOpen] = useState(false)
  const [forwardingMessageId, setForwardingMessageId] = useState<string | null>(null)
  const [quotedMessage, setQuotedMessage] = useState<any | null>(null)
  const [patientPanelOpen, setPatientPanelOpen] = useState(false)
  const [transcribingId, setTranscribingId] = useState<string | null>(null)

  // Limpa a seleção e reseta o flag "tem mais" sempre que troca de chat
  useEffect(() => {
    setHasMoreOlder(true)
    clearSelection()
    setSendError(null)
  }, [chat?.id, clearSelection])

  // Atalho do teclado (Esc) para cancelar a seleção
  useEffect(() => {
    if (!isSelectionMode) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        clearSelection()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isSelectionMode, clearSelection])

  const handleLoadOlder = async () => {
    if (!onLoadOlder || isLoadingOlder) return
    setIsLoadingOlder(true)
    try {
      const result = await onLoadOlder()
      if (!result || !result.hasMore) {
        setHasMoreOlder(false)
      }
    } catch (err: any) {
      toast.error('Erro ao carregar mensagens mais antigas: ' + (err?.message || 'Tente novamente'))
    } finally {
      setIsLoadingOlder(false)
    }
  }

  useEffect(() => {
    if (!chat || chat.type === 'group') {
      setIsInCrm(false)
      return
    }
    const checkCrm = async () => {
      try {
        const records = await pb.collection('crm_contacts').getList(1, 1, {
          filter: `jid = '${chat.remote_jid}' && instance_name = '${chat.instance_name}'`,
          requestKey: null,
        })
        setIsInCrm(records.items.length > 0)
      } catch (err) {
        setIsInCrm(false)
      }
    }
    checkCrm()
  }, [chat])

  const handleOpenAddToCrm = () => {
    if (!chat || chat.type === 'group' || isInCrm) return
    setIsAddCrmDialogOpen(true)
  }

  // Audio recording states
  const [isRecording, setIsRecording] = useState(false)
  const [recordingDuration, setRecordingDuration] = useState(0)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioChunksRef = useRef<Blob[]>([])
  const recordingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const streamRef = useRef<MediaStream | null>(null)

  useEffect(() => {
    return () => {
      if (mediaPreviewUrl) URL.revokeObjectURL(mediaPreviewUrl)
      if (recordingIntervalRef.current) clearInterval(recordingIntervalRef.current)
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop())
      }
    }
  }, [mediaPreviewUrl])

  const formatDuration = (seconds: number) => {
    const m = Math.floor(seconds / 60)
      .toString()
      .padStart(2, '0')
    const s = (seconds % 60).toString().padStart(2, '0')
    return `${m}:${s}`
  }

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      const options = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? { mimeType: 'audio/webm;codecs=opus' }
        : { mimeType: 'audio/webm' }

      const recorder = new MediaRecorder(stream, options)
      mediaRecorderRef.current = recorder
      audioChunksRef.current = []

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          audioChunksRef.current.push(e.data)
        }
      }

      recorder.start(200)
      setIsRecording(true)
      setRecordingDuration(0)

      recordingIntervalRef.current = setInterval(() => {
        setRecordingDuration((prev) => {
          if (prev >= 1800) {
            toast.error('Áudio muito longo. Máximo 30 minutos.')
            cancelRecording()
            return prev
          }
          return prev + 1
        })
      }, 1000)
    } catch (err) {
      toast.error('Não foi possível acessar o microfone. Verifique as permissões do navegador.')
    }
  }

  const stopRecording = () => {
    if (!mediaRecorderRef.current || mediaRecorderRef.current.state === 'inactive') return

    mediaRecorderRef.current.onstop = async () => {
      const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' })
      const file = new File([audioBlob], `audio_${Date.now()}.webm`, { type: 'audio/webm' })

      setIsRecording(false)
      if (recordingIntervalRef.current) clearInterval(recordingIntervalRef.current)
      setRecordingDuration(0)

      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop())
        streamRef.current = null
      }

      if (onSendMedia) {
        setIsSending(true)
        try {
          await onSendMedia(file, 'audio', '')
        } catch (e) {
          toast.error('Falha ao enviar áudio. Tente novamente')
        } finally {
          setIsSending(false)
        }
      }
    }

    mediaRecorderRef.current.stop()
  }

  const cancelRecording = () => {
    if (!mediaRecorderRef.current) return

    mediaRecorderRef.current.onstop = null
    mediaRecorderRef.current.stop()

    setIsRecording(false)
    if (recordingIntervalRef.current) clearInterval(recordingIntervalRef.current)
    setRecordingDuration(0)
    audioChunksRef.current = []

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop())
      streamRef.current = null
    }
  }

  const triggerFileInput = (accept: string) => {
    if (fileInputRef.current) {
      fileInputRef.current.accept = accept
      fileInputRef.current.click()
    }
  }

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    const accept = fileInputRef.current?.accept || '*/*'
    let type: 'image' | 'video' | 'document' | 'audio' = 'document'

    if (accept.includes('audio')) {
      type = 'audio'
    } else if (accept.includes('image')) {
      if (file.type.startsWith('video/')) type = 'video'
      else type = 'image'
    } else {
      if (file.type.startsWith('image/')) type = 'image'
      else if (file.type.startsWith('video/')) type = 'video'
      else if (file.type.startsWith('audio/')) type = 'audio'
    }

    const sizeMB = file.size / (1024 * 1024)
    if (type === 'image' && sizeMB > 5) {
      toast.error('A imagem deve ter no máximo 5MB')
      return
    }
    if ((type === 'video' || type === 'audio') && sizeMB > 16) {
      toast.error('O vídeo/áudio deve ter no máximo 16MB')
      return
    }
    if (type === 'document' && sizeMB > 100) {
      toast.error('O documento deve ter no máximo 100MB')
      return
    }

    setMediaFile(file)
    setSelectedMediaType(type)
    setMediaPreviewUrl(URL.createObjectURL(file))
    setMediaCaption('')
    setSendMediaModalOpen(true)

    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const prevMessagesLengthRef = useRef(0)
  const prevFirstMessageIdRef = useRef<string | undefined>(undefined)

  useLayoutEffect(() => {
    const container = scrollContainerRef.current
    if (!container) return

    const messages = chat?.messages || []
    if (messages.length === 0) return

    const firstMessageId = messages[0]?.id
    const isPrepended =
      prevFirstMessageIdRef.current && prevFirstMessageIdRef.current !== firstMessageId

    if (isPrepended && container.dataset.prevHeight) {
      const prevHeight = parseInt(container.dataset.prevHeight, 10)
      const currentHeight = container.scrollHeight
      container.scrollTop += currentHeight - prevHeight
    } else {
      const isNearBottom =
        container.scrollHeight - container.scrollTop - container.clientHeight < 300
      const isFirstLoad =
        prevMessagesLengthRef.current === 0 || prevFirstMessageIdRef.current === undefined

      if (isFirstLoad || isNearBottom) {
        messagesEndRef.current?.scrollIntoView({ behavior: isFirstLoad ? 'auto' : 'smooth' })
      }
    }

    prevFirstMessageIdRef.current = firstMessageId
    prevMessagesLengthRef.current = messages.length
    container.dataset.prevHeight = container.scrollHeight.toString()
  }, [chat?.messages])

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!inputText.trim() || isSending) return

    const textToSend = inputText.trim()
    const quoteId = quotedMessage?.id
    setIsSending(true)
    setSendError(null)
    try {
      if (quoteId) {
        // Enviar com citação via endpoint direto de envio
        await enviarTexto(chat.instance_name, chat.remote_jid, textToSend, quoteId)
      } else if (onSendMessage) {
        await onSendMessage(textToSend)
      } else {
        await enviarTexto(chat.instance_name, chat.remote_jid, textToSend)
      }
      setInputText('')
      setQuotedMessage(null)
    } catch (error) {
      setSendError(getErrorMessage(error))
    } finally {
      setIsSending(false)
    }
  }

  const handleReplyMessage = (msg: any) => {
    setQuotedMessage(msg)
  }

  const handleForwardMessage = (msg: any) => {
    setForwardingMessageId(msg.id)
    setForwardModalOpen(true)
  }

  const handleTranscribeMessage = async (msgId: string) => {
    if (transcribingId) return
    setTranscribingId(msgId)
    try {
      const res = await transcreverAudio(msgId)
      if (res?.transcription) {
        toast.success('Áudio transcrito com sucesso!')
        const m = (chat.messages || []).find((x: any) => x.id === msgId)
        if (m) m.transcription = res.transcription
      }
    } catch (err: any) {
      const errMsg =
        err?.data?.error ||
        err?.response?.error ||
        err?.message ||
        'Transcrição real indisponível no momento.'
      toast.error(errMsg)
    } finally {
      setTranscribingId(null)
    }
  }

  const handleSendMediaSubmit = async () => {
    if (!mediaFile || !selectedMediaType || isSending || !onSendMedia) return

    setIsSending(true)
    setSendError(null)
    try {
      await onSendMedia(mediaFile, selectedMediaType, mediaCaption)
      toast.success('Mídia enviada com sucesso')
      setSendMediaModalOpen(false)
      setMediaFile(null)
      setMediaCaption('')
      if (mediaPreviewUrl) URL.revokeObjectURL(mediaPreviewUrl)
      setMediaPreviewUrl(null)
    } catch (error) {
      setSendError(getErrorMessage(error))
    } finally {
      setIsSending(false)
    }
  }

  const handleSelectMedia = useCallback(
    (media: { url: string; type: string; mimetype?: string; name?: string }) => {
      setSelectedMedia(media)
      setMediaModalOpen(true)
    },
    [],
  )

  const handleTaskView = useCallback((msgId: string) => {
    setTaskViewMessageId(msgId)
  }, [])

  return (
    <div className="flex flex-col h-full bg-[#f0f2f5] relative w-full">
      {/* WhatsApp Pattern Background */}
      <div
        className="absolute inset-0 opacity-40 z-0 pointer-events-none"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg width='100' height='100' viewBox='0 0 100 100' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M10 10 L20 20 M30 10 L40 20' stroke='%230f3b21' stroke-width='1' fill='none' opacity='0.2'/%3E%3C/svg%3E")`,
          backgroundSize: '100px 100px',
        }}
      />

      {/* Header */}
      <div className="bg-white px-4 py-3 border-b border-border flex items-center justify-between z-10 shadow-sm">
        <div className="flex items-center gap-3">
          {isMobile && (
            <Button
              variant="ghost"
              size="icon"
              onClick={onBack}
              className="mr-1 -ml-2 rounded-full"
            >
              <ArrowLeft className="w-5 h-5 text-primary" />
            </Button>
          )}
          <Avatar className="h-10 w-10 border border-border cursor-pointer">
            {chat.avatar ? <AvatarImage src={chat.avatar} /> : null}
            <AvatarFallback>{chat.name?.charAt(0)?.toUpperCase() || '?'}</AvatarFallback>
          </Avatar>
          <div className="flex flex-col cursor-pointer">
            <span className="font-semibold text-primary text-base leading-tight">
              {resolveDisplayName(chat.name, chat.remote_jid)}
            </span>
            <span className="text-xs text-muted-foreground">
              {chat.type === 'group'
                ? `${chat.groupDetails?.participants || 0} participantes`
                : 'online'}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <CategoryPicker
            categories={categories}
            selectedIds={chat.category_ids || []}
            onChange={async (ids) => {
              try {
                await pb
                  .collection('conversations')
                  .update(chat.id, { category_ids: ids }, { requestKey: null })
              } catch (err) {
                toast.error('Erro ao atualizar categorias')
              }
            }}
            className="hidden sm:flex rounded-full text-xs font-semibold bg-white/50 border-primary/20 hover:bg-primary/5 transition-colors"
          />
          <AgenteConversaToggle chat={chat} isMobile={isMobile} />
          {chat?.type !== 'group' && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleOpenCareSecretary}
              title="Abrir Secretária de Cuidado deste paciente"
              className={cn(
                'rounded-full text-xs font-semibold border-rose-200 text-rose-600 hover:bg-rose-50 hover:text-rose-700 transition-colors min-h-[40px]',
                isMobile ? 'px-2.5 min-w-[40px]' : 'px-3',
              )}
            >
              <HeartPulse className="w-4 h-4 sm:mr-1.5" />
              <span className="hidden sm:inline">Cuidado</span>
            </Button>
          )}
          {chat?.type !== 'group' && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPatientPanelOpen((prev) => !prev)}
              title="Abrir painel de contexto do paciente"
              className={cn(
                'rounded-full text-xs font-semibold border-primary/20 transition-colors min-h-[40px]',
                patientPanelOpen
                  ? 'bg-primary text-white border-primary hover:bg-primary/90'
                  : 'text-primary hover:bg-primary/5',
                isMobile ? 'px-2.5 min-w-[40px]' : 'px-3',
              )}
            >
              <UserCheck className="w-4 h-4 sm:mr-1.5" />
              <span className="hidden sm:inline">Paciente</span>
            </Button>
          )}
          {chat?.type !== 'group' && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleOpenAddToCrm}
              disabled={isInCrm || isAddingCrm}
              className={cn(
                'hidden sm:flex rounded-full text-xs font-semibold border-primary/20 transition-colors',
                isInCrm
                  ? 'bg-emerald-50 text-emerald-600 border-emerald-200 hover:bg-emerald-50 opacity-100'
                  : 'text-primary hover:bg-primary/5',
              )}
            >
              {isAddingCrm ? (
                <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
              ) : isInCrm ? (
                <Check className="w-3.5 h-3.5 mr-1.5" />
              ) : null}
              {isInCrm ? 'Adicionado' : 'Adicionar ao CRM'}
            </Button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="rounded-full min-h-[44px] min-w-[44px]"
                aria-label="Mais opções"
              >
                <MoreVertical className="w-5 h-5 text-muted-foreground" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuItem
                onClick={() => {
                  // Se o nome atual é "lixo" (só dígitos longos ou "Você"),
                  // pré-preenche o input vazio pra mostrar o placeholder e
                  // facilitar a digitação do nome real.
                  setEditNameValue(isInvalidContactName(chat.name) ? '' : chat.name || '')
                  setIsEditNameOpen(true)
                }}
              >
                <Pencil className="mr-2 h-4 w-4" />
                Editar nome do contato
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={async () => {
                  try {
                    await alternarArquivamentoConversa(chat.id, !chat.archived)
                    toast.success(chat.archived ? 'Conversa desarquivada' : 'Conversa arquivada')
                    onBack()
                  } catch (err) {
                    toast.error('Erro ao arquivar/desarquivar conversa')
                  }
                }}
              >
                {chat.archived ? 'Desarquivar Conversa' : 'Arquivar Conversa'}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Messages Area */}
      <div
        ref={scrollContainerRef}
        className="flex-1 overflow-y-auto overflow-x-hidden p-4 z-10 flex flex-col gap-1"
      >
        {/* Botão "Carregar mais antigas" (paginação no banco) — aparece no
            topo da conversa quando ainda há mensagens mais velhas no banco
            que não caberam na primeira página de 50. Não depende da
            Evolution: é só um getList com filtro timestamp < oldest. */}
        {onLoadOlderDb && (chat.messages || []).length > 0 && hasMoreOlderDb && (
          <div className="flex justify-center mb-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={onLoadOlderDb}
              disabled={loadingOlderDb}
              className="rounded-full h-8 text-xs text-muted-foreground hover:text-primary hover:bg-primary/5 px-4"
            >
              {loadingOlderDb ? (
                <span className="inline-flex items-center">
                  <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" />
                  Carregando...
                </span>
              ) : (
                'Carregar mais antigas'
              )}
            </Button>
          </div>
        )}
        {/* Botão "Carregar mensagens mais antigas" (sync Evolution) — só
            aparece se há handler, tem pelo menos 1 msg, e ainda há histórico
            não puxado do aparelho. Coexiste com o de paginação no banco:
            este busca no celular mensagens que ainda nem estão no banco. */}
        {onLoadOlder && (chat.messages || []).length > 0 && hasMoreOlder && (
          <div className="flex justify-center mb-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleLoadOlder}
              disabled={isLoadingOlder}
              className="rounded-full h-8 text-xs text-muted-foreground hover:text-primary hover:bg-primary/5 px-4"
            >
              {isLoadingOlder ? (
                <span className="inline-flex items-center">
                  <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" />
                  Carregando...
                </span>
              ) : (
                'Carregar mensagens mais antigas do aparelho'
              )}
            </Button>
          </div>
        )}
        {(chat.messages || []).map((msg: any, idx: number) => {
          const isMe = msg.senderId === 'me'
          const prevMsg = chat.messages?.[idx - 1]
          const isFirstInGroup = idx === 0 || prevMsg?.senderId !== msg.senderId
          const showSenderName = chat.type === 'group' && !isMe && isFirstInGroup
          const senderColor = chat.groupDetails?.colors?.[msg.senderId] || '#5A6B5A'
          const isSelected = selectedMessages.has(msg.id)

          // Separador de data estilo WhatsApp
          // Compara o dia civil da mensagem atual com o da anterior no fuso America/Sao_Paulo
          const currentDayKey = getDayKeySaoPaulo(msg.timestamp)
          const prevDayKey = prevMsg ? getDayKeySaoPaulo(prevMsg.timestamp) : ''
          const showDateSeparator = idx === 0 || (currentDayKey && currentDayKey !== prevDayKey)
          const separatorLabel = showDateSeparator ? getChatDateSeparatorLabel(msg.timestamp) : ''

          return (
            <React.Fragment key={msg.id}>
              {showDateSeparator && separatorLabel && (
                <div className="flex items-center justify-center my-3 select-none pointer-events-none sticky top-1 z-10">
                  <div className="bg-white/95 dark:bg-muted/90 backdrop-blur-md text-foreground/80 font-medium text-[11px] px-3.5 py-1 rounded-full shadow-sm border border-border/60 tracking-wider uppercase">
                    {separatorLabel}
                  </div>
                </div>
              )}
              <MessageItem
                msg={msg}
                isMe={isMe}
                isFirstInGroup={isFirstInGroup}
                showSenderName={showSenderName}
                senderColor={senderColor}
                isSelectionMode={isSelectionMode}
                isSelected={isSelected}
                localHighlight={localHighlight}
                tasksForMessage={tasksByMessageId.get(msg.id)}
                onToggleSelection={toggleSelection}
                onSelectMedia={handleSelectMedia}
                onTaskView={handleTaskView}
                onReply={handleReplyMessage}
                onForward={handleForwardMessage}
                onTranscribe={handleTranscribeMessage}
                transcribingId={transcribingId}
              />
            </React.Fragment>
          )
        })}

        {chat.ai_enabled &&
          (chat.messages || []).length > 0 &&
          chat.messages[chat.messages.length - 1].pending_ai_response &&
          !chat.messages[chat.messages.length - 1].from_me && (
            <div className="flex self-start animate-fade-in-up mt-2 mb-2">
              <div className="bg-white text-muted-foreground rounded-2xl rounded-tl-none border border-border/50 px-4 py-2 shadow-sm flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin text-primary" />
                <span className="text-sm font-medium">IA analisando...</span>
              </div>
            </div>
          )}

        <div ref={messagesEndRef} />
      </div>

      {isSelectionMode && (
        <TaskActionBar
          selectedCount={selectedMessages.size}
          onCancel={clearSelection}
          onCreateTask={() => setIsTaskModalOpen(true)}
        />
      )}

      <TaskFormDialog
        open={isTaskModalOpen}
        onOpenChange={setIsTaskModalOpen}
        chat={chat}
        selectedMessages={selectedMessagesArray}
        onSuccess={clearSelection}
      />

      <TaskViewDialog
        open={!!taskViewMessageId && taskViewTasks.length > 0}
        onOpenChange={(open) => {
          if (!open) setTaskViewMessageId(null)
        }}
        tasks={taskViewTasks}
      />

      {sendError && (
        <div className="bg-destructive/5 px-3 pt-3 z-10 border-t border-destructive/20">
          <Alert variant="destructive" className="relative pr-10">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Falha ao enviar mensagem</AlertTitle>
            <AlertDescription>
              <span className="block text-sm">{sendError}</span>
              {chat?.name && (
                <span className="block text-xs mt-1 opacity-80">Destinatário: {chat.name}</span>
              )}
            </AlertDescription>
            <button
              onClick={() => setSendError(null)}
              className="absolute top-3 right-3 text-destructive/70 hover:text-destructive transition-colors"
              aria-label="Fechar"
            >
              <X className="h-4 w-4" />
            </button>
          </Alert>
        </div>
      )}

      {/* Preview de Citação / Resposta */}
      {quotedMessage && (
        <div className="bg-muted/70 px-4 py-2 border-t border-border flex items-center justify-between z-10 text-xs">
          <div className="border-l-4 border-primary pl-2 overflow-hidden flex-1 mr-2">
            <span className="font-semibold text-primary block truncate">
              Respondendo para{' '}
              {quotedMessage.senderId === 'me'
                ? 'Você'
                : quotedMessage.pushName || resolveDisplayName(null, quotedMessage.senderId)}
            </span>
            <span className="text-muted-foreground truncate block">
              {quotedMessage.text || quotedMessage.media?.name || '[Mídia]'}
            </span>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 rounded-full text-muted-foreground hover:text-foreground shrink-0"
            onClick={() => setQuotedMessage(null)}
          >
            <X className="w-3.5 h-3.5" />
          </Button>
        </div>
      )}

      {/* Input Area */}
      <div className="bg-white p-3 md:p-4 border-t border-border z-10 flex items-end gap-2">
        <input
          type="file"
          ref={fileInputRef}
          className="hidden"
          onChange={handleFileSelect}
          accept="*/*"
        />

        {!isRecording && (
          <>
            <Button
              variant="ghost"
              size="icon"
              disabled={isSending}
              className="rounded-full shrink-0 text-muted-foreground hover:text-primary"
            >
              <Smile className="w-6 h-6" />
            </Button>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  disabled={isSending}
                  className="rounded-full shrink-0 text-muted-foreground hover:text-primary"
                >
                  <Paperclip className="w-6 h-6" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" sideOffset={12} className="w-48 p-2 rounded-2xl">
                <DropdownMenuItem
                  onClick={() => triggerFileInput('image/*,video/*')}
                  className="cursor-pointer gap-3 p-3 rounded-xl hover:bg-primary/5"
                >
                  <div className="bg-blue-100 p-2 rounded-full text-blue-600">
                    <ImageIcon className="w-5 h-5" />
                  </div>
                  <span className="font-medium">Fotos e Vídeos</span>
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => triggerFileInput('*/*')}
                  className="cursor-pointer gap-3 p-3 rounded-xl hover:bg-primary/5"
                >
                  <div className="bg-purple-100 p-2 rounded-full text-purple-600">
                    <FileText className="w-5 h-5" />
                  </div>
                  <span className="font-medium">Documento</span>
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => triggerFileInput('audio/*')}
                  className="cursor-pointer gap-3 p-3 rounded-xl hover:bg-primary/5"
                >
                  <div className="bg-orange-100 p-2 rounded-full text-orange-600">
                    <Mic className="w-5 h-5" />
                  </div>
                  <span className="font-medium">Áudio</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <TemplatePicker
              accountId={account?.id}
              hasMessages={(chat?.messages || []).length > 0}
              lastMessageTimestamp={
                chat?.messages?.length > 0
                  ? chat.messages[chat.messages.length - 1]?.timestamp
                  : undefined
              }
              onSelect={(content) => setInputText(content)}
              onManage={() => setIsTemplateManageOpen(true)}
            />

            <form
              onSubmit={handleSend}
              className="flex-1 flex items-end gap-2 bg-background rounded-2xl border border-border px-1 focus-within:ring-2 focus-within:ring-primary/20 transition-all"
            >
              {' '}
              <textarea
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                disabled={isSending}
                placeholder={isSending ? 'Enviando...' : 'Digite sua mensagem...'}
                className="w-full bg-transparent border-none focus:outline-none resize-none max-h-32 py-3 px-3 min-h-[44px] text-[15px] scrollbar-thin scrollbar-thumb-border disabled:opacity-50"
                rows={1}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    handleSend(e as unknown as React.FormEvent)
                  }
                }}
              />
            </form>
          </>
        )}

        {isRecording && (
          <div className="flex-1 flex items-center justify-between bg-red-50/50 rounded-full border border-red-100 px-4 py-2 min-h-[44px]">
            <Button
              variant="ghost"
              size="icon"
              onClick={cancelRecording}
              className="rounded-full text-destructive hover:text-destructive hover:bg-destructive/10 h-8 w-8"
            >
              <Trash2 className="w-5 h-5" />
            </Button>
            <div className="flex-1 flex items-center justify-center gap-2">
              <div className="w-2.5 h-2.5 rounded-full bg-destructive animate-pulse" />
              <span className="text-[15px] font-medium tabular-nums text-destructive">
                {formatDuration(recordingDuration)}
              </span>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={stopRecording}
              className="rounded-full text-primary hover:text-primary hover:bg-primary/10 h-8 w-8 bg-primary/5"
            >
              <Send className="w-4 h-4 ml-0.5" />
            </Button>
          </div>
        )}

        {!isRecording &&
          (inputText.trim() || isSending ? (
            <Button
              onClick={handleSend}
              disabled={isSending}
              size="icon"
              className="rounded-full shrink-0 h-11 w-11 bg-primary hover:bg-primary/90 text-white shadow-sm transition-transform active:scale-95 disabled:opacity-70"
            >
              {isSending ? (
                <Loader2 className="w-5 h-5 ml-1 animate-spin" />
              ) : (
                <Send className="w-5 h-5 ml-1" />
              )}
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="icon"
              disabled={isSending}
              onClick={startRecording}
              className="rounded-full shrink-0 h-11 w-11 text-muted-foreground hover:text-primary hover:bg-primary/5"
            >
              <Mic className="w-6 h-6" />
            </Button>
          ))}
      </div>

      {/* Media Send Modal */}
      {/* Dialog de "Editar nome do contato". Edita o contact_name na
          collection conversations e, se houver crm_contact pra esse jid,
          também espelha lá (consistência). Realtime do PocketBase
          repropaga o novo nome pra todos os componentes que mostram
          essa conversa. */}
      <Dialog
        open={isEditNameOpen}
        onOpenChange={(open) => !isSavingName && setIsEditNameOpen(open)}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Pencil className="w-5 h-5 text-primary" />
              Editar nome do contato
            </DialogTitle>
            <DialogDescription>
              Esse nome aparece na lista de conversas e no CRM. Útil pra contatos que vieram sem
              nome do WhatsApp ou ficaram com número como rótulo.
            </DialogDescription>
          </DialogHeader>

          <div className="mt-2 space-y-2">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Nome
            </label>
            <Input
              value={editNameValue}
              onChange={(e) => setEditNameValue(e.target.value)}
              disabled={isSavingName}
              placeholder="Ex.: João Silva"
              autoFocus
              maxLength={100}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  handleSaveContactName()
                }
              }}
            />
            <p className="text-[11px] text-muted-foreground">
              Deixe em branco pra remover o nome custom — a lista volta a mostrar o número
              formatado.
            </p>
          </div>

          <DialogFooter className="gap-2 sm:justify-end mt-4">
            <Button
              variant="ghost"
              onClick={() => setIsEditNameOpen(false)}
              disabled={isSavingName}
              className="rounded-xl"
            >
              Cancelar
            </Button>
            <Button onClick={handleSaveContactName} disabled={isSavingName} className="rounded-xl">
              {isSavingName ? (
                <span className="inline-flex items-center">
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Salvando...
                </span>
              ) : (
                <span className="inline-flex items-center">
                  <Check className="w-4 h-4 mr-2" />
                  Salvar
                </span>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog de pré-validação pra adicionar no CRM. Mostrado quando o
          user clica no botão "Adicionar ao CRM" no header. Permite editar
          nome, vincular empresa, definir cargo/email/estágio antes de
          criar o registro. Após criar com sucesso, atualiza isInCrm pra
          desabilitar o botão. */}
      <AddToCrmDialog
        open={isAddCrmDialogOpen}
        onClose={() => setIsAddCrmDialogOpen(false)}
        instance_name={chat?.instance_name}
        remote_jid={chat?.remote_jid}
        initialName={chat?.name}
        onAdded={() => setIsInCrm(true)}
      />

      <Dialog open={sendMediaModalOpen} onOpenChange={setSendMediaModalOpen}>
        <DialogContent className="max-w-[calc(100vw-2rem)] sm:max-w-md bg-white border-border overflow-hidden mx-auto">
          <DialogHeader>
            <DialogTitle>Enviar Mídia</DialogTitle>
            <DialogDescription>Confirme o envio do arquivo</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col items-center justify-center p-4 gap-4 bg-muted/30 rounded-lg border border-border">
            {selectedMediaType === 'image' && mediaPreviewUrl && (
              <img
                src={mediaPreviewUrl}
                alt="Preview"
                className="max-h-64 object-contain rounded-md shadow-sm"
              />
            )}
            {selectedMediaType === 'video' && mediaPreviewUrl && (
              <video
                src={mediaPreviewUrl}
                controls
                className="max-h-64 w-full rounded-md shadow-sm"
              />
            )}
            {selectedMediaType === 'audio' && mediaPreviewUrl && (
              <div className="w-full p-4 bg-background rounded-full shadow-sm flex items-center justify-center">
                <audio src={mediaPreviewUrl} controls className="w-full h-10" />
              </div>
            )}
            {selectedMediaType === 'document' && (
              <div className="flex items-center gap-3 p-4 bg-background rounded-lg shadow-sm w-full max-w-full min-w-0 border border-border/50">
                <div className="p-3 bg-primary/10 rounded-full text-primary shrink-0">
                  <FileText className="w-8 h-8" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium truncate text-sm" title={mediaFile?.name}>
                    {mediaFile?.name}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {(mediaFile?.size || 0) / 1024 > 1024
                      ? ((mediaFile?.size || 0) / (1024 * 1024)).toFixed(2) + ' MB'
                      : ((mediaFile?.size || 0) / 1024).toFixed(0) + ' KB'}
                  </p>
                </div>
              </div>
            )}
          </div>
          {selectedMediaType !== 'audio' && (
            <div className="mt-2">
              <Input
                value={mediaCaption}
                onChange={(e) => setMediaCaption(e.target.value)}
                placeholder="Adicionar legenda (opcional)..."
                disabled={isSending}
                className="w-full"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    handleSendMediaSubmit()
                  }
                }}
              />
            </div>
          )}
          <DialogFooter className="mt-4 flex gap-2 sm:justify-end">
            <Button
              variant="ghost"
              onClick={() => setSendMediaModalOpen(false)}
              disabled={isSending}
            >
              Cancelar
            </Button>
            <Button onClick={handleSendMediaSubmit} disabled={isSending} className="min-w-24">
              {isSending ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Enviar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Media Modal Preview (Received Media) */}
      <Dialog open={mediaModalOpen} onOpenChange={setMediaModalOpen}>
        <DialogContent className="max-w-4xl p-0 overflow-hidden bg-black/95 border-none shadow-2xl h-[90vh] flex flex-col">
          <DialogHeader className="sr-only">
            <DialogTitle>Visualização de Mídia</DialogTitle>
            <DialogDescription>Preview de {selectedMedia?.name}</DialogDescription>
          </DialogHeader>
          <div className="relative w-full flex-1 flex flex-col min-h-0">
            <div className="flex-1 flex items-center justify-center p-4 min-h-0">
              {selectedMedia?.type === 'image' && (
                <LazyMediaPreview
                  url={selectedMedia.url}
                  type="image"
                  className="max-w-full max-h-full object-contain"
                />
              )}
              {selectedMedia?.type === 'document' &&
                selectedMedia.mimetype === 'application/pdf' && (
                  <LazyMediaPreview
                    url={selectedMedia.url}
                    type="pdf"
                    className="w-full h-full rounded-lg bg-white"
                  />
                )}
            </div>
            {selectedMedia?.type === 'image' && (
              <div className="bg-background/10 backdrop-blur-md p-4 flex items-center gap-2 border-t border-white/10 shrink-0">
                <Input
                  placeholder="Adicionar legenda..."
                  className="bg-white/10 border-none text-white placeholder:text-white/50 h-12 rounded-xl"
                />
                <Button className="h-12 w-12 rounded-xl bg-primary hover:bg-primary/90">
                  <Send className="w-5 h-5" />
                </Button>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={isTemplateManageOpen} onOpenChange={setIsTemplateManageOpen}>
        <DialogContent className="sm:max-w-md max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Modelos de Mensagem</DialogTitle>
            <DialogDescription>Gerencie os modelos disponíveis no chat.</DialogDescription>
          </DialogHeader>
          {account?.id && <MessageTemplatesSection accountId={account.id} />}
        </DialogContent>
      </Dialog>

      {/* Secretária de Cuidado aberta a partir da conversa do WhatsApp.
          Recebe o contexto do paciente ativo (nome, telefone/JID, estágio,
          status de cuidado, última consulta e id no CRM) pra a IA responder
          com conhecimento do caso. */}
      <CareSecretarySheet
        open={careSheetOpen}
        onOpenChange={setCareSheetOpen}
        contextTask={null}
        contactContext={careContactContext}
      />
      {/* Diálogo de Encaminhamento de Mensagem */}
      <ForwardDialog
        open={forwardModalOpen}
        onOpenChange={setForwardModalOpen}
        instanceName={chat.instance_name}
        messageId={forwardingMessageId}
        conversations={conversations}
      />

      {/* Painel Lateral de Contexto do Paciente */}
      <PatientContextPanel
        open={patientPanelOpen}
        onClose={() => setPatientPanelOpen(false)}
        remoteJid={chat.remote_jid}
        contactName={chat.name}
        instanceName={chat.instance_name}
        onOpenAddToCrm={handleOpenAddToCrm}
      />
    </div>
  )
}
