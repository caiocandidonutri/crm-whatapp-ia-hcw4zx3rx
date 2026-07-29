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
  FileDown,
  Eye,
  AlertCircle,
  Loader2,
  Trash2,
  Check,
  Pencil,
  ListTodo,
} from 'lucide-react'
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
import { alternarArquivamentoConversa, atualizarNomeContato } from '@/services/whatsapp_service'
import { jidToDisplayName, isInvalidContactName } from '@/lib/whatsapp-mappers'
import { useLinkPreview } from '@/hooks/use-link-preview'
import { AddToCrmDialog } from '@/components/crm/AddToCrmDialog'
import { AgenteConversaToggle } from '@/components/chat/AgenteConversaToggle'
import { TaskActionBar } from '@/components/chat/TaskActionBar'
import { TaskFormDialog } from '@/components/chat/TaskFormDialog'
import { TaskViewDialog } from '@/components/chat/TaskViewDialog'
import { useLongPress } from '@/hooks/use-long-press'
import pb from '@/lib/pocketbase/client'
import { getTasks } from '@/services/tasks'
import { Task } from '@/types/models'
import { useRealtime } from '@/hooks/use-realtime'
import { CategoryPicker } from '@/components/categories/CategoryPicker'
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

// Detecta URLs em texto e renderiza como hyperlink colorido. Sem dependência
// externa — regex simples cobre http(s) URLs. Quando o texto vem com link,
// o card de preview embedded (msg.linkPreview) continua aparecendo se o
// backend conseguiu extrair OG tags via Baileys; se não conseguiu, o
// usuário ainda tem o link clicável aqui em cor diferente, pelo menos.
//
// Cor: branco azulado em msgs minhas (fundo verde), azul padrão em msgs
// recebidas (fundo branco). Mantém legibilidade em ambos os casos.
const URL_REGEX = /(https?:\/\/[^\s<>]+)/g

// Card de preview embedded para URLs detectadas no texto que NÃO têm
// linkPreview vindo do banco. Faz lazy fetch via /backend/v1/whatsapp/
// link-preview quando o componente monta. Se o backend não conseguir
// extrair OG tags úteis, retorna null (não renderiza nada).
function LinkPreviewCard({ url, isMe }: { url: string; isMe: boolean }) {
  const preview = useLinkPreview(url)
  if (!preview) return null

  let hostname = ''
  try {
    hostname = new URL(preview.url).hostname
  } catch {
    hostname = preview.url
  }

  return (
    <a
      href={preview.url}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      className={cn(
        'block mb-1 mx-1 mt-1 rounded-lg overflow-hidden bg-black/5 hover:bg-black/10 transition-colors border-l-4',
        isMe ? 'border-white/50' : 'border-primary/50',
      )}
    >
      {preview.image && (
        <img
          src={preview.image}
          alt="Preview"
          className="w-full h-32 object-cover"
          onError={(e) => {
            ;(e.target as HTMLImageElement).style.display = 'none'
          }}
        />
      )}
      <div className="p-2">
        {preview.title && <h4 className="font-bold text-sm line-clamp-1">{preview.title}</h4>}
        {preview.description && (
          <p className="text-xs opacity-80 line-clamp-2 mt-0.5">{preview.description}</p>
        )}
        <span className="text-[10px] opacity-60 uppercase mt-1 block truncate">{hostname}</span>
      </div>
    </a>
  )
}

// Extrai todas as URLs do texto. Usada pra decidir se renderiza
// LinkPreviewCard (apenas quando há exatamente 1 URL no texto).
function extractUrls(text: string): string[] {
  if (!text) return []
  const matches = text.match(URL_REGEX)
  return matches || []
}
function renderTextWithLinks(
  text: string,
  isMe: boolean,
  isHighlighted?: boolean,
): React.ReactNode[] {
  if (!text) return []
  const parts: React.ReactNode[] = []
  let lastIndex = 0
  let match: RegExpExecArray | null
  URL_REGEX.lastIndex = 0
  while ((match = URL_REGEX.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index))
    }
    parts.push(
      <a
        key={`link-${match.index}`}
        href={match[0]}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()}
        className={cn(
          'underline break-all hover:opacity-80',
          isHighlighted ? '!text-blue-700 font-medium' : isMe ? 'text-blue-100' : 'text-blue-600',
        )}
      >
        {match[0]}
      </a>,
    )
    lastIndex = match.index + match[0].length
  }
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex))
  }
  return parts
}

function MessageRow({
  msg,
  isSelected,
  isSelectionMode,
  toggleSelection,
  children,
}: {
  msg: any
  isSelected: boolean
  isSelectionMode: boolean
  toggleSelection: (id: string) => void
  children: React.ReactNode
}) {
  const { handlers, isPressing } = useLongPress({
    onLongPress: () => {
      if (!isSelectionMode) {
        toggleSelection(msg.id)
      }
    },
    onClick: () => {
      if (isSelectionMode) {
        toggleSelection(msg.id)
      }
    },
  })

  return (
    <div
      {...handlers}
      className={cn(
        'group relative flex flex-col w-full transition-colors -mx-4 px-4 py-0.5',
        isSelectionMode || isPressing ? 'select-none' : '',
        isSelected ? 'bg-primary/5' : '',
      )}
    >
      <div
        className={cn(
          'absolute top-1/2 -translate-y-1/2 z-20 flex items-center justify-center transition-all duration-200',
          isSelectionMode
            ? 'left-6 opacity-100 cursor-pointer'
            : 'left-2 opacity-0 md:group-hover:opacity-100 cursor-pointer',
        )}
        onClick={(e) => {
          e.stopPropagation()
          toggleSelection(msg.id)
        }}
        data-selection-toggle="true"
        aria-label={isSelected ? 'Desmarcar mensagem' : 'Selecionar mensagem'}
      >
        <div
          className={cn(
            'w-5 h-5 rounded-full border flex items-center justify-center transition-colors',
            isSelected
              ? 'bg-primary border-primary'
              : 'border-muted-foreground/40 bg-background/90 hover:border-primary',
          )}
        >
          {isSelected && <Check className="w-3 h-3 text-white" />}
        </div>
      </div>

      <div
        className={cn(
          'flex flex-col w-full transition-all duration-200',
          isSelectionMode ? 'pl-10' : '',
        )}
      >
        {children}
      </div>
    </div>
  )
}

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
}

export function ChatArea({
  chat,
  onBack,
  onSendMessage,
  onSendMedia,
  onLoadOlder,
  isMobile,
  highlightMsgId,
}: ChatAreaProps) {
  const [inputText, setInputText] = useState('')
  const [isSending, setIsSending] = useState(false)
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

  // Limpa a seleção e reseta o flag "tem mais" sempre que troca de chat
  useEffect(() => {
    setHasMoreOlder(true)
    clearSelection()
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
  const recordingIntervalRef = useRef<NodeJS.Timeout | null>(null)
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
    if (!inputText.trim() || isSending || !onSendMessage) return

    setIsSending(true)
    try {
      await onSendMessage(inputText)
      setInputText('')
    } catch (error) {
      // erro tratado no Conversas.tsx
    } finally {
      setIsSending(false)
    }
  }

  const handleSendMediaSubmit = async () => {
    if (!mediaFile || !selectedMediaType || isSending || !onSendMedia) return

    setIsSending(true)
    try {
      await onSendMedia(mediaFile, selectedMediaType, mediaCaption)
      toast.success('Mídia enviada com sucesso')
      setSendMediaModalOpen(false)
      setMediaFile(null)
      setMediaCaption('')
      if (mediaPreviewUrl) URL.revokeObjectURL(mediaPreviewUrl)
      setMediaPreviewUrl(null)
    } catch (error) {
      toast.error('Falha ao enviar mídia. Tente novamente')
    } finally {
      setIsSending(false)
    }
  }

  const renderMedia = (msg: any, isMe: boolean) => {
    if (msg.status === 'media_failed') {
      return (
        <div
          className={cn(
            'flex items-center gap-2 p-2 rounded-lg mb-1',
            isMe ? 'bg-black/10 text-white/80' : 'bg-black/5 text-muted-foreground',
          )}
        >
          <AlertCircle className="w-5 h-5 shrink-0" />
          <span className="text-sm italic">Mídia indisponível</span>
        </div>
      )
    }

    if (!msg.media) return null

    const { type, url, name, mimetype } = msg.media

    if (type === 'image') {
      return (
        <img
          src={url}
          alt="attachment"
          className="rounded-lg mb-1 max-w-full w-auto max-h-[300px] object-cover cursor-pointer hover:opacity-90 transition-opacity"
          onClick={(e) => {
            e.stopPropagation()
            setSelectedMedia({ url, type, mimetype, name })
            setMediaModalOpen(true)
          }}
        />
      )
    }

    if (type === 'video') {
      return (
        <video
          src={url}
          controls
          onClick={(e) => e.stopPropagation()}
          className="rounded-lg mb-1 max-w-full w-auto max-h-[300px] object-cover cursor-pointer"
        />
      )
    }

    if (type === 'audio') {
      return (
        <div className="mb-1 rounded-xl min-w-[200px] w-full flex items-center">
          <audio
            src={url}
            controls
            onClick={(e) => e.stopPropagation()}
            className="w-full h-10 max-w-full bg-transparent"
          />
        </div>
      )
    }

    if (type === 'document') {
      return (
        <div
          className={cn(
            'flex items-center gap-3 p-3 rounded-lg mb-1 w-full min-w-0',
            isMe ? 'bg-black/10' : 'bg-black/5',
          )}
        >
          <div className={cn('p-2 rounded-full shrink-0', isMe ? 'bg-white/20' : 'bg-primary/10')}>
            <FileText className={cn('w-5 h-5', isMe ? 'text-white' : 'text-primary')} />
          </div>
          <div className="flex-1 min-w-0 overflow-hidden">
            <p className="font-medium text-sm truncate" title={name}>
              {name}
            </p>
            <p
              className={cn(
                'text-[11px] uppercase truncate',
                isMe ? 'text-white/70' : 'text-muted-foreground',
              )}
            >
              {mimetype ? mimetype.split('/')[1] || 'Documento' : 'Documento'}
            </p>
          </div>
          <div className="flex shrink-0 gap-1">
            {mimetype === 'application/pdf' && (
              <Button
                variant="ghost"
                size="icon"
                className={cn(
                  'rounded-full w-8 h-8',
                  isMe ? 'hover:bg-black/20 text-white' : 'hover:bg-black/10 text-primary',
                )}
                onClick={(e) => {
                  e.stopPropagation()
                  setSelectedMedia({ url, type, mimetype, name })
                  setMediaModalOpen(true)
                }}
              >
                <Eye className="w-4 h-4" />
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              asChild
              onClick={(e) => e.stopPropagation()}
              className={cn(
                'rounded-full w-8 h-8',
                isMe ? 'hover:bg-black/20 text-white' : 'hover:bg-black/10 text-primary',
              )}
            >
              <a href={url} download={name || 'document'} target="_blank" rel="noreferrer">
                <FileDown className="w-4 h-4" />
              </a>
            </Button>
          </div>
        </div>
      )
    }

    if (type === 'sticker') {
      return (
        <img src={url} alt="sticker" className="w-32 h-32 object-contain drop-shadow-sm mb-1" />
      )
    }

    return null
  }

  const formatTime = (ts: string) => {
    try {
      return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    } catch {
      return ts
    }
  }

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
            <AvatarImage src={chat.avatar} />
            <AvatarFallback>{chat.name?.charAt(0)?.toUpperCase() || '?'}</AvatarFallback>
          </Avatar>
          <div className="flex flex-col cursor-pointer">
            <span className="font-semibold text-primary text-base leading-tight">
              {chat.name || 'Sem nome'}
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
              <Button variant="ghost" size="icon" className="rounded-full">
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
        {/* Botão "Carregar mais antigas" — só aparece se há handler, tem pelo menos
            1 msg, e ainda há histórico não puxado */}
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
                <>
                  <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" />
                  Carregando...
                </>
              ) : (
                'Carregar mensagens mais antigas'
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
          const isSticker = msg.media?.type === 'sticker'
          const hasMedia = !!msg.media && !isSticker

          const isSelected = selectedMessages.has(msg.id)

          return (
            <MessageRow
              key={msg.id}
              msg={msg}
              isSelected={isSelected}
              isSelectionMode={isSelectionMode}
              toggleSelection={toggleSelection}
            >
              <div
                data-message-id={msg.id}
                className={cn(
                  'flex flex-col w-fit min-w-0 max-w-[85%] sm:max-w-[70%] md:max-w-[60%]',
                  isMe ? 'self-end' : 'self-start animate-fade-in-up',
                  isFirstInGroup && idx !== 0 ? 'mt-2' : '',
                )}
              >
                <div className="relative flex flex-col w-full">
                  {!isSelectionMode &&
                    tasksByMessageId.get(msg.id) &&
                    tasksByMessageId.get(msg.id)!.length > 0 && (
                      <div
                        data-task-marker="true"
                        onClick={(e) => {
                          e.stopPropagation()
                          setTaskViewMessageId(msg.id)
                        }}
                        className={cn(
                          'absolute top-1/2 -translate-y-1/2 z-20 flex items-center justify-center w-7 h-7 rounded-full text-white cursor-pointer shadow-sm ring-2 hover:scale-110 transition-transform',
                          isMe ? '-left-10' : '-right-10',
                          (() => {
                            const tasks = tasksByMessageId.get(msg.id)!
                            const active = tasks.find((t) => t.status === 'em_andamento')
                            const pending = tasks.find((t) => t.status === 'pendente')
                            const status = active?.status || pending?.status || tasks[0]?.status
                            switch (status) {
                              case 'pendente':
                                return 'bg-slate-500 ring-slate-500/30'
                              case 'em_andamento':
                                return 'bg-amber-500 ring-amber-500/30'
                              case 'concluida':
                                return 'bg-emerald-500 ring-emerald-500/30'
                              case 'cancelada':
                                return 'bg-rose-500 ring-rose-500/30'
                              default:
                                return 'bg-slate-500 ring-slate-500/30'
                            }
                          })(),
                        )}
                      >
                        <ListTodo className="w-3.5 h-3.5" />
                        {tasksByMessageId.get(msg.id)!.length > 1 && (
                          <span className="absolute -top-1 -right-1 bg-primary text-white text-[9px] font-bold w-3.5 h-3.5 rounded-full flex items-center justify-center ring-1 ring-white">
                            {tasksByMessageId.get(msg.id)!.length}
                          </span>
                        )}
                      </div>
                    )}
                  <div
                    className={cn(
                      'relative text-[15px] flex flex-col w-auto min-w-0 overflow-hidden transition-all duration-500',
                      !isSticker && 'shadow-sm',
                      !isSticker && (hasMedia ? 'p-1' : 'px-3 py-2 pb-5'),
                      localHighlight === msg.id && !isSticker
                        ? 'bg-yellow-100 ring-2 ring-yellow-400 !text-slate-900 z-10 scale-[1.02]'
                        : isMe && !isSticker
                          ? 'bg-[#0a7c52] text-white rounded-2xl ml-auto'
                          : !isSticker
                            ? 'bg-white text-foreground rounded-2xl border border-border/50'
                            : 'ml-auto',
                      isFirstInGroup && !isSticker
                        ? isMe
                          ? 'rounded-tr-none'
                          : 'rounded-tl-none'
                        : '',
                    )}
                  >
                    {isFirstInGroup && !isSticker && (
                      <div
                        className={cn(
                          'absolute top-0 w-3 h-3 overflow-hidden',
                          isMe ? '-right-2' : '-left-2',
                        )}
                      >
                        <div
                          className={cn(
                            'w-4 h-4 rounded-full absolute -top-1',
                            isMe
                              ? '-left-1 bg-[#0a7c52]'
                              : '-right-1 bg-white border border-border/50',
                          )}
                        />
                      </div>
                    )}

                    {showSenderName && !isSticker && (
                      <span
                        className={cn('text-xs font-bold mb-1', hasMedia ? 'px-2 pt-1' : '')}
                        style={{ color: senderColor }}
                      >
                        {(() => {
                          // Hierarquia: pushName real > número formatado (BR ou +N)
                          // > "Participante" (pra @lid e JIDs sem dígitos).
                          // Antes, números longos como 148541477503216 apareciam
                          // crus; agora vêm como +148541477503216 ou +55 11 99999-9999.
                          if (msg.pushName) return msg.pushName
                          const formatted = jidToDisplayName(msg.senderId)
                          return formatted === 'Sem nome' ? 'Participante' : formatted
                        })()}
                      </span>
                    )}

                    {renderMedia(msg, isMe)}

                    {msg.linkPreview && (
                      <a
                        href={msg.linkPreview.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className={cn(
                          'block mb-1 mx-1 mt-1 rounded-lg overflow-hidden bg-black/5 hover:bg-black/10 transition-colors border-l-4',
                          isMe ? 'border-white/50' : 'border-primary/50',
                        )}
                      >
                        {msg.linkPreview.thumbnailB64 && (
                          <img
                            src={`data:image/jpeg;base64,${msg.linkPreview.thumbnailB64}`}
                            alt="Preview"
                            className="w-full h-32 object-cover"
                          />
                        )}
                        <div className="p-2">
                          <h4 className="font-bold text-sm line-clamp-1">
                            {msg.linkPreview.title}
                          </h4>
                          <p className="text-xs opacity-80 line-clamp-2 mt-0.5">
                            {msg.linkPreview.description}
                          </p>
                          <span className="text-[10px] opacity-60 uppercase mt-1 block truncate">
                            {(() => {
                              try {
                                return new URL(msg.linkPreview.url).hostname
                              } catch {
                                return msg.linkPreview.url
                              }
                            })()}
                          </span>
                        </div>
                      </a>
                    )}

                    {!msg.linkPreview &&
                      msg.text &&
                      (() => {
                        // Render preview embedded automático quando há
                        // EXATAMENTE 1 URL no texto e o backend não nos
                        // deu um linkPreview pronto. Múltiplas URLs ficam
                        // só com o linkify in-text — mostrar 3 cards num
                        // só balão polui.
                        const urls = extractUrls(msg.text)
                        if (urls.length !== 1) return null
                        return <LinkPreviewCard url={urls[0]} isMe={isMe} />
                      })()}

                    {msg.text && (
                      <div className={cn('flex-1 min-w-0', hasMedia ? 'px-2 pb-5' : '')}>
                        <p
                          className={cn(
                            'leading-snug break-words whitespace-pre-wrap',
                            isSticker &&
                              'bg-white/80 p-2 rounded-lg text-sm text-foreground mt-1 shadow-sm',
                          )}
                        >
                          {renderTextWithLinks(msg.text, isMe, localHighlight === msg.id)}
                        </p>
                      </div>
                    )}

                    <span
                      className={cn(
                        'text-[10px] opacity-60 flex items-center gap-1 pointer-events-none transition-colors',
                        localHighlight === msg.id
                          ? '!text-slate-600'
                          : isMe && !isSticker
                            ? 'text-white'
                            : 'text-muted-foreground',
                        isSticker &&
                          'bg-white/80 px-2 py-0.5 rounded-full backdrop-blur-sm self-end mt-1',
                        !isSticker && 'absolute bottom-1 right-2',
                      )}
                    >
                      {formatTime(msg.timestamp)}
                      {isMe && <Check className="w-3 h-3 ml-0.5 opacity-80" />}
                    </span>
                  </div>

                  {msg.ai_response_error && (
                    <div className="mt-1 text-[10px] text-destructive flex items-center gap-1 bg-destructive/10 px-2 py-0.5 rounded-md">
                      <AlertCircle className="w-3 h-3" />
                      Erro na IA: {msg.ai_response_error}
                    </div>
                  )}

                  {msg.reactions && msg.reactions.length > 0 && (
                    <div
                      onClick={(e) => e.stopPropagation()}
                      className={cn(
                        'absolute -bottom-2 flex flex-wrap gap-1 px-2 py-1 rounded-full bg-white border border-border shadow-sm text-base z-10',
                        isMe ? 'right-2' : 'left-2',
                      )}
                    >
                      {Array.from(new Set(msg.reactions.map((r: any) => r.emoji))).map(
                        (emoji: string, i) => (
                          <span key={i} className="leading-none">
                            {emoji}
                          </span>
                        ),
                      )}
                      {msg.reactions.length > 1 && (
                        <span className="text-[11px] font-bold text-muted-foreground ml-0.5 leading-none self-center">
                          {msg.reactions.length}
                        </span>
                      )}
                    </div>
                  )}
                </div>

                {/* Spacer for reactions overflow */}
                {msg.reactions && msg.reactions.length > 0 && <div className="h-4 w-full" />}
              </div>
            </MessageRow>
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

            <form
              onSubmit={handleSend}
              className="flex-1 flex items-end gap-2 bg-background rounded-2xl border border-border px-1 focus-within:ring-2 focus-within:ring-primary/20 transition-all"
            >
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
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Salvando...
                </>
              ) : (
                <>
                  <Check className="w-4 h-4 mr-2" />
                  Salvar
                </>
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
                <img
                  src={selectedMedia.url}
                  alt="Preview"
                  className="max-w-full max-h-full object-contain"
                />
              )}
              {selectedMedia?.type === 'document' &&
                selectedMedia.mimetype === 'application/pdf' && (
                  <iframe
                    src={selectedMedia.url}
                    className="w-full h-full rounded-lg bg-white"
                    title="PDF Preview"
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
    </div>
  )
}
