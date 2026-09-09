import React, { memo } from 'react'
import {
  Check,
  ListTodo,
  AlertCircle,
  Forward,
  Reply,
  Copy,
  Sparkles,
  MoreVertical,
  Volume2,
} from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { useLongPress } from '@/hooks/use-long-press'
import { jidToDisplayName } from '@/lib/whatsapp-mappers'
import { Task } from '@/types/models'
import { formatTimeSaoPaulo } from '@/lib/datetime'
import { extractUrls, renderTextWithLinks } from '@/lib/link-utils'
import { LinkPreviewCard } from '@/components/chat/LinkPreviewCard'
import { MessageMedia } from '@/components/chat/MessageMedia'
import {
  UnsupportedMessageCard,
  isUnsupportedMessageType,
} from '@/components/chat/UnsupportedMessageCard'

type SelectedMedia = { url: string; type: string; mimetype?: string; name?: string }

interface MessageItemProps {
  msg: any
  isMe: boolean
  isFirstInGroup: boolean
  showSenderName: boolean
  senderColor: string
  isSelectionMode: boolean
  isSelected: boolean
  localHighlight: string | null
  tasksForMessage: Task[] | undefined
  onToggleSelection: (id: string) => void
  onSelectMedia: (media: SelectedMedia) => void
  onTaskView: (msgId: string) => void
  onReply?: (msg: any) => void
  onForward?: (msg: any) => void
  onTranscribe?: (msgId: string) => void
  transcribingId?: string | null
}

function formatTime(ts: string) {
  return formatTimeSaoPaulo(ts) || ts
}

function MessageItemComponent({
  msg,
  isMe,
  isFirstInGroup,
  showSenderName,
  senderColor,
  isSelectionMode,
  isSelected,
  localHighlight,
  tasksForMessage,
  onToggleSelection,
  onSelectMedia,
  onTaskView,
  onReply,
  onForward,
  onTranscribe,
  transcribingId,
}: MessageItemProps) {
  const { handlers, isPressing } = useLongPress({
    onLongPress: () => {
      if (!isSelectionMode) onToggleSelection(msg.id)
    },
    onClick: () => {
      if (isSelectionMode) onToggleSelection(msg.id)
    },
  })

  const isSticker = msg.media?.type === 'sticker'
  const hasMedia = !!msg.media && !isSticker
  const hasTasks = !!tasksForMessage && tasksForMessage.length > 0
  const urls = msg.text ? extractUrls(msg.text) : []
  const isUnsupported = isUnsupportedMessageType(msg.messageType) && !hasMedia
  const isAudio =
    msg.media?.type === 'audio' ||
    msg.messageType === 'audioMessage' ||
    msg.messageType === 'audio' ||
    msg.media?.mimetype?.includes('audio')

  const handleCopyText = (e: React.MouseEvent) => {
    e.stopPropagation()
    const textToCopy = msg.text || msg.transcription || ''
    if (!textToCopy) return
    navigator.clipboard.writeText(textToCopy)
    toast.success('Texto copiado para a área de transferência')
  }

  const taskColor = (() => {
    if (!tasksForMessage) return ''
    const a = tasksForMessage.find((t) => t.status === 'em_andamento')
    const p = tasksForMessage.find((t) => t.status === 'pendente')
    const s = a?.status || p?.status || tasksForMessage[0]?.status
    switch (s) {
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
  })()

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
          onToggleSelection(msg.id)
        }}
        data-selection-toggle="true"
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
        <div
          data-message-id={msg.id}
          className={cn(
            'flex flex-col w-fit min-w-0 max-w-[85%] sm:max-w-[70%] md:max-w-[60%]',
            isMe ? 'self-end' : 'self-start animate-fade-in-up',
            isFirstInGroup && 'mt-2',
          )}
        >
          <div className="relative flex flex-col w-full">
            {!isSelectionMode && hasTasks && (
              <div
                data-task-marker="true"
                onClick={(e) => {
                  e.stopPropagation()
                  onTaskView(msg.id)
                }}
                className={cn(
                  'absolute top-1/2 -translate-y-1/2 z-20 flex items-center justify-center w-7 h-7 rounded-full text-white cursor-pointer shadow-sm ring-2 hover:scale-110 transition-transform',
                  isMe ? '-left-10' : '-right-10',
                  taskColor,
                )}
              >
                <ListTodo className="w-3.5 h-3.5" />
                {tasksForMessage!.length > 1 && (
                  <span className="absolute -top-1 -right-1 bg-primary text-white text-[9px] font-bold w-3.5 h-3.5 rounded-full flex items-center justify-center ring-1 ring-white">
                    {tasksForMessage!.length}
                  </span>
                )}
              </div>
            )}
            {/* Menu de contexto da mensagem (Encaminhar, Responder, Copiar) */}
            {!isSelectionMode && (
              <div
                className={cn(
                  'absolute top-1 z-30 opacity-0 group-hover:opacity-100 transition-opacity',
                  isMe ? '-left-8' : '-right-8',
                )}
              >
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 rounded-full bg-background/80 shadow-sm border border-border/60 hover:bg-muted text-muted-foreground"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <MoreVertical className="w-3.5 h-3.5" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align={isMe ? 'end' : 'start'} className="w-44">
                    <DropdownMenuItem
                      onClick={(e) => {
                        e.stopPropagation()
                        onReply?.(msg)
                      }}
                      className="cursor-pointer"
                    >
                      <Reply className="w-4 h-4 mr-2 text-primary" />
                      Responder
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={(e) => {
                        e.stopPropagation()
                        onForward?.(msg)
                      }}
                      className="cursor-pointer"
                    >
                      <Forward className="w-4 h-4 mr-2 text-blue-500" />
                      Encaminhar
                    </DropdownMenuItem>
                    {msg.text && (
                      <DropdownMenuItem onClick={handleCopyText} className="cursor-pointer">
                        <Copy className="w-4 h-4 mr-2 text-slate-500" />
                        Copiar texto
                      </DropdownMenuItem>
                    )}
                    {isAudio && !isMe && !msg.transcription && onTranscribe && (
                      <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          onClick={(e) => {
                            e.stopPropagation()
                            onTranscribe(msg.id)
                          }}
                          className="cursor-pointer text-amber-600 focus:text-amber-700"
                        >
                          <Sparkles className="w-4 h-4 mr-2" />
                          Transcrever áudio
                        </DropdownMenuItem>
                      </>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
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
                isFirstInGroup && !isSticker ? (isMe ? 'rounded-tr-none' : 'rounded-tl-none') : '',
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
                      isMe ? '-left-1 bg-[#0a7c52]' : '-right-1 bg-white border border-border/50',
                    )}
                  />
                </div>
              )}
              {showSenderName && !isSticker && (
                <span
                  className={cn('text-xs font-bold mb-1', hasMedia ? 'px-2 pt-1' : '')}
                  style={{ color: senderColor }}
                >
                  {msg.pushName ||
                    (() => {
                      const f = jidToDisplayName(msg.senderId)
                      return f === 'Sem nome' ? 'Participante' : f
                    })()}
                </span>
              )}
              <MessageMedia
                media={msg.media}
                isMe={isMe}
                status={msg.status}
                onSelectMedia={onSelectMedia}
              />

              {/* Botão e exibição de Transcrição de Áudio recebido */}
              {isAudio && !isMe && (
                <div className="px-2 pb-2 pt-1">
                  {msg.transcription ? (
                    <div className="mt-1 p-2 rounded-lg bg-primary/5 border border-primary/20 text-xs text-foreground/90">
                      <div className="flex items-center gap-1 font-semibold text-[11px] text-primary mb-1">
                        <Sparkles className="w-3 h-3" />
                        Transcrição IA:
                      </div>
                      <p className="leading-relaxed select-text">{msg.transcription}</p>
                    </div>
                  ) : (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation()
                        onTranscribe?.(msg.id)
                      }}
                      disabled={transcribingId === msg.id}
                      className="h-6 px-2 text-[11px] text-amber-700 hover:text-amber-800 bg-amber-50 hover:bg-amber-100 rounded-md border border-amber-200"
                    >
                      <Sparkles className="w-3 h-3 mr-1" />
                      {transcribingId === msg.id ? 'Transcrevendo...' : 'Transcrever áudio'}
                    </Button>
                  )}
                </div>
              )}
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
                    <h4 className="font-bold text-sm line-clamp-1">{msg.linkPreview.title}</h4>
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
              {!msg.linkPreview && urls.length === 1 && (
                <LinkPreviewCard url={urls[0]} isMe={isMe} />
              )}
              {msg.isForwarded && (
                <div
                  className={cn(
                    'flex items-center gap-1 mb-1 mx-1 mt-1 text-[10px] font-medium',
                    isMe ? 'text-white/70' : 'text-muted-foreground',
                  )}
                >
                  <Forward className="w-3 h-3" />
                  Encaminhado
                </div>
              )}
              {msg.text && !isUnsupported && (
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
              {isUnsupported && (
                <div className={cn('flex-1 min-w-0', hasMedia ? 'px-2 pb-5' : '')}>
                  <UnsupportedMessageCard type={msg.messageType} isMe={isMe} caption={msg.text} />
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
          {msg.reactions && msg.reactions.length > 0 && <div className="h-4 w-full" />}
        </div>
      </div>
    </div>
  )
}

export const MessageItem = memo(
  MessageItemComponent,
  (prev, next) =>
    prev.msg === next.msg &&
    prev.isMe === next.isMe &&
    prev.isFirstInGroup === next.isFirstInGroup &&
    prev.showSenderName === next.showSenderName &&
    prev.senderColor === next.senderColor &&
    prev.isSelectionMode === next.isSelectionMode &&
    prev.isSelected === next.isSelected &&
    prev.localHighlight === next.localHighlight &&
    prev.tasksForMessage === next.tasksForMessage &&
    prev.onToggleSelection === next.onToggleSelection &&
    prev.onSelectMedia === next.onSelectMedia &&
    prev.onTaskView === next.onTaskView &&
    prev.transcribingId === next.transcribingId &&
    prev.msg.transcription === next.msg.transcription,
)
