import React, { useMemo, useState, useEffect } from 'react'
import {
  Search,
  RefreshCw,
  MessageCircle,
  Image as ImageIcon,
  Video,
  Mic,
  FileText,
  Sticker,
  Loader2,
  Archive,
  ArchiveRestore,
  MoreVertical,
  History,
  Wrench,
  LogOut,
  Trash2,
  CheckCheck,
  CheckCircle2,
  Users,
  User,
  AlertCircle,
  AlertTriangle,
} from 'lucide-react'
import {
  marcarConversaComoLida,
  finalizarConversa,
  zerarNaoLidasEmLote,
} from '@/services/whatsapp_service'
import { useToast } from '@/hooks/use-toast'
import { Chat } from '@/lib/mock-data'
import { cn } from '@/lib/utils'
import { formatChatListTimestamp } from '@/lib/format-time'
import { formatPhoneBR } from '@/lib/phone'
import { Input } from '@/components/ui/input'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useCategories } from '@/hooks/use-categories'
import { useCurrentAccount } from '@/hooks/use-current-account'
import { CATEGORY_COLOR_MAP } from '@/lib/colors'

type ChatListProps = {
  chats: Chat[]
  activeChatId: string | null
  onSelectChat: (id: string) => void
  className?: string
  loading?: boolean
  error?: string | null
  pendingCount?: number
  loadingMore?: boolean
  showArchived?: boolean
  hasMore?: boolean
  onLoadMore?: () => void
  onToggleArchived?: () => void
  onRefresh?: () => void
  onReimportHistory?: () => void
  onDiagnose?: () => void
  onDisconnect?: () => void
  onFactoryReset?: () => void
  onSearchChange?: (term: string) => void
  messageMatchJids?: Set<string>
  messageMatchPreviews?: Map<string, string>
  realtimeStatus?: 'connecting' | 'connected' | 'reconnecting' | 'disconnected'
}

const SKELETON_ROWS = 6

function ChatRowSkeleton() {
  return (
    <div className="w-full p-4 flex items-center gap-3">
      <Skeleton className="h-12 w-12 rounded-full shrink-0" />
      <div className="flex-1 min-w-0 space-y-2">
        <div className="flex items-center justify-between">
          <Skeleton className="h-3 w-32" />
          <Skeleton className="h-3 w-10" />
        </div>
        <Skeleton className="h-3 w-2/3" />
      </div>
    </div>
  )
}

type ChatRowProps = {
  chat: Chat
  isActive: boolean
  onSelectChat: (id: string) => void
  messagePreview?: string
  onMarkAsRead?: (chatId: string) => void
  onFinalizeChat?: (chatId: string) => void
}

const ChatRow = React.memo(function ChatRow({
  chat,
  isActive,
  onSelectChat,
  messagePreview,
  onMarkAsRead,
  onFinalizeChat,
}: ChatRowProps) {
  if (!chat) return null
  const lastMsg = chat.messages?.[(chat.messages?.length || 0) - 1] ?? null
  const unreadCount = chat.unread || 0
  const hasAvatar = !!chat.avatar

  return (
    <div
      onClick={() => onSelectChat(chat.id)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          onSelectChat(chat.id)
        }
      }}
      className={cn(
        'group w-full p-4 flex items-center gap-3 transition-colors text-left relative overflow-hidden cursor-pointer select-none',
        isActive ? 'bg-primary/5' : 'hover:bg-black/5',
      )}
    >
      {isActive && <div className="absolute left-0 top-0 bottom-0 w-1 bg-primary" />}

      <Avatar className="h-12 w-12 border border-border shrink-0">
        {hasAvatar ? <AvatarImage src={chat.avatar} /> : null}
        <AvatarFallback>{chat.name?.charAt(0)?.toUpperCase() || '?'}</AvatarFallback>
      </Avatar>

      <div className="flex-1 min-w-0 flex flex-col justify-center">
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-2 truncate">
            <span className="font-semibold text-primary truncate">
              {chat.name || formatPhoneBR(chat.remote_jid) || 'Contato WhatsApp'}
            </span>
            {chat.type === 'group' && (
              <Badge
                variant="secondary"
                className="text-[9px] px-1 py-0 h-4 bg-primary/10 text-primary shrink-0"
              >
                GRUPO
              </Badge>
            )}
          </div>
          <span
            className={cn(
              'text-xs whitespace-nowrap ml-2 shrink-0',
              unreadCount > 0 ? 'text-emerald-600 font-semibold' : 'text-muted-foreground',
            )}
          >
            {formatChatListTimestamp(chat.lastMessage?.timestamp || lastMsg?.timestamp)}
          </span>
        </div>

        <div className="flex items-center justify-between gap-2 min-w-0">
          <div
            className={cn(
              'text-sm truncate flex items-center gap-1 min-w-0 flex-1',
              unreadCount > 0 ? 'text-foreground font-medium' : 'text-muted-foreground',
            )}
          >
            {messagePreview ? (
              <span className="contents">
                <Search className="w-3 h-3 shrink-0 text-primary" />
                <span className="truncate italic text-primary/70">{messagePreview}</span>
              </span>
            ) : (
              <span className="contents">
                {(chat.lastMessage?.fromMe || lastMsg?.senderId === 'me') && (
                  <span className="shrink-0">Você: </span>
                )}

                {(() => {
                  const type = chat.lastMessage?.type || lastMsg?.media?.type
                  const text = chat.lastMessage?.text || lastMsg?.text || ''
                  const isPhoto = type === 'image' || text === 'Foto'
                  const isVideo = type === 'video' || text === 'Vídeo'
                  const isAudio = type === 'audio' || text === 'Áudio'
                  const isDoc = type === 'document' || text === 'Documento'
                  const isSticker = type === 'sticker' || text === 'Figurinha'

                  if (isPhoto) return <ImageIcon className="w-3.5 h-3.5 shrink-0 opacity-70" />
                  if (isVideo) return <Video className="w-3.5 h-3.5 shrink-0 opacity-70" />
                  if (isAudio) return <Mic className="w-3.5 h-3.5 shrink-0 opacity-70" />
                  if (isDoc) return <FileText className="w-3.5 h-3.5 shrink-0 opacity-70" />
                  if (isSticker) return <Sticker className="w-3.5 h-3.5 shrink-0 opacity-70" />
                  return null
                })()}

                <span
                  className={cn(
                    'truncate',
                    ['Foto', 'Vídeo', 'Áudio', 'Documento', 'Figurinha'].includes(
                      chat.lastMessage?.text || '',
                    ) || lastMsg?.media
                      ? 'italic opacity-70'
                      : '',
                  )}
                >
                  {chat.lastMessage?.text || lastMsg?.text || (lastMsg?.media ? 'Mídia' : '')}
                </span>
              </span>
            )}
          </div>

          <div className="flex items-center gap-1 shrink-0">
            {/* Botões de Ação Direta no Card: Desktop hover */}
            <div className="hidden md:flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
              {unreadCount > 0 && onMarkAsRead && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-muted-foreground hover:text-emerald-600 hover:bg-emerald-50 rounded-full"
                  title="Marcar como lida"
                  onClick={(e) => {
                    e.stopPropagation()
                    onMarkAsRead(chat.id)
                  }}
                >
                  <CheckCheck className="w-4 h-4" />
                </Button>
              )}
              {onFinalizeChat && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-muted-foreground hover:text-primary hover:bg-primary/10 rounded-full"
                  title="Finalizar conversa (lida + arquivar)"
                  onClick={(e) => {
                    e.stopPropagation()
                    onFinalizeChat(chat.id)
                  }}
                >
                  <CheckCircle2 className="w-4 h-4" />
                </Button>
              )}
            </div>

            {/* Mobile: menu de 3 pontinhos acessível por toque */}
            <div className="md:hidden flex items-center">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9 -mr-1 text-muted-foreground hover:text-foreground rounded-full"
                    onClick={(e) => e.stopPropagation()}
                    aria-label="Opções da conversa"
                  >
                    <MoreVertical className="w-4 h-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="end"
                  className="w-48"
                  onClick={(e) => e.stopPropagation()}
                >
                  {onMarkAsRead && (
                    <DropdownMenuItem
                      onClick={(e) => {
                        e.stopPropagation()
                        onMarkAsRead(chat.id)
                      }}
                      className="min-h-[44px] flex items-center gap-2 cursor-pointer"
                    >
                      <CheckCheck className="w-4 h-4 text-emerald-600" />
                      <span>Marcar como lida</span>
                    </DropdownMenuItem>
                  )}
                  {onFinalizeChat && (
                    <DropdownMenuItem
                      onClick={(e) => {
                        e.stopPropagation()
                        onFinalizeChat(chat.id)
                      }}
                      className="min-h-[44px] flex items-center gap-2 cursor-pointer"
                    >
                      <CheckCircle2 className="w-4 h-4 text-primary" />
                      <span>Finalizar conversa</span>
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            {unreadCount > 0 && (
              <div className="bg-emerald-500 text-white text-[10px] font-bold h-5 min-w-[20px] px-1.5 rounded-full flex items-center justify-center shrink-0">
                {unreadCount}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
})

export function ChatList({
  chats,
  activeChatId,
  onSelectChat,
  className,
  loading = false,
  error = null,
  pendingCount = 0,
  loadingMore = false,
  showArchived = false,
  hasMore = false,
  onLoadMore,
  onToggleArchived,
  onRefresh,
  onReimportHistory,
  onDiagnose,
  onDisconnect,
  onFactoryReset,
  onSearchChange,
  messageMatchJids,
  messageMatchPreviews,
  realtimeStatus,
}: ChatListProps) {
  const safeChats = chats || []
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null)
  const [chatTypeFilter, setChatTypeFilter] = useState<'all' | 'direct' | 'group'>('all')
  const [isClearingGroupUnreads, setIsClearingGroupUnreads] = useState(false)

  const { account } = useCurrentAccount()
  const { categories } = useCategories(account?.id)
  const { toast } = useToast()

  const groupChats = useMemo(() => {
    return (safeChats || []).filter((c) => c && c.type === 'group')
  }, [safeChats])

  const unreadGroupCount = useMemo(() => {
    return groupChats.reduce((acc, c) => acc + (c?.unread || 0), 0)
  }, [groupChats])

  const filteredChats = useMemo(() => {
    let filtered = (safeChats || []).filter((c) => !!c)

    if (chatTypeFilter === 'direct') {
      filtered = filtered.filter((c) => c && c.type !== 'group')
    } else if (chatTypeFilter === 'group') {
      filtered = filtered.filter((c) => c && c.type === 'group')
    }

    if (selectedCategory) {
      filtered = filtered.filter(
        (c) => Array.isArray(c?.category_ids) && c.category_ids.includes(selectedCategory),
      )
    }

    if (searchTerm.trim()) {
      const q = searchTerm.toLowerCase().trim()
      filtered = filtered.filter((c) => {
        if (!c) return false
        const haystack = `${c.name || ''} ${c.phone || ''}`.toLowerCase()
        return (
          haystack.includes(q) ||
          (Boolean(c.remote_jid) && (messageMatchJids?.has(c.remote_jid || '') ?? false))
        )
      })
    }

    return filtered
  }, [safeChats, chatTypeFilter, searchTerm, selectedCategory, messageMatchJids])

  const handleMarkAsRead = async (chatId: string) => {
    try {
      await marcarConversaComoLida(chatId)
      toast({
        title: 'Conversa marcada como lida',
        duration: 2000,
      })
    } catch {
      toast({
        title: 'Erro ao marcar conversa como lida',
        variant: 'destructive',
      })
    }
  }

  const handleFinalizeChat = async (chatId: string) => {
    try {
      await finalizarConversa(chatId)
      toast({
        title: 'Conversa finalizada',
        description: 'Marcada como lida e movida para arquivadas.',
        duration: 2500,
      })
    } catch {
      toast({
        title: 'Erro ao finalizar conversa',
        variant: 'destructive',
      })
    }
  }

  const handleClearAllGroupUnreads = async () => {
    const unreadGroups = groupChats.filter((c) => (c.unread || 0) > 0)
    if (unreadGroups.length === 0) return

    setIsClearingGroupUnreads(true)
    try {
      await zerarNaoLidasEmLote(unreadGroups.map((g) => g.id))
      toast({
        title: 'Não lidas de grupos zeradas',
        description: `${unreadGroups.length} grupo(s) atualizados com sucesso.`,
      })
    } catch {
      toast({
        title: 'Erro ao zerar não lidas dos grupos',
        variant: 'destructive',
      })
    } finally {
      setIsClearingGroupUnreads(false)
    }
  }

  const [globalHasMore, setGlobalHasMore] = useState(false)
  const [globalLoadingMore, setGlobalLoadingMore] = useState(false)

  useEffect(() => {
    const handlePagination = (e: Event) => {
      const detail = (e as CustomEvent).detail
      if (detail) {
        setGlobalHasMore(detail.hasMore)
        setGlobalLoadingMore(detail.loadingMore)
      }
    }
    document.addEventListener('whatsapp-pagination', handlePagination)
    return () => document.removeEventListener('whatsapp-pagination', handlePagination)
  }, [])

  const showSkeleton = loading && safeChats.length === 0
  const showEmpty = !loading && safeChats.length === 0
  const showNoMatches = !loading && safeChats.length > 0 && filteredChats.length === 0
  const isCurrentlyLoadingMore = loadingMore || globalLoadingMore
  const canLoadMore = hasMore || globalHasMore

  const hasOwnerActions = !!(onReimportHistory || onDiagnose || onDisconnect || onFactoryReset)

  const isReconnecting = realtimeStatus === 'connecting' || realtimeStatus === 'reconnecting'

  return (
    <div className={cn('flex flex-col h-full bg-white border-r border-border', className)}>
      {isReconnecting && (
        <div className="bg-amber-500/15 border-b border-amber-300 text-amber-900 px-3 py-1.5 text-xs flex items-center justify-center gap-2 font-medium animate-pulse shrink-0">
          <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-700" />
          <span>Sincronizando novas mensagens...</span>
        </div>
      )}

      <div className="p-4 border-b border-border flex flex-col gap-3 bg-background/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              value={searchTerm}
              onChange={(e) => {
                setSearchTerm(e.target.value)
                onSearchChange?.(e.target.value)
              }}
              placeholder="Buscar conversa ou mensagem..."
              className="pl-9 bg-white border-border rounded-xl"
            />
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon" className="rounded-xl shrink-0">
                <MoreVertical className="w-4 h-4 text-muted-foreground" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              {unreadGroupCount > 0 && (
                <span className="contents">
                  <DropdownMenuItem
                    onClick={handleClearAllGroupUnreads}
                    disabled={isClearingGroupUnreads}
                    className="text-emerald-700 font-medium"
                  >
                    <CheckCheck className="mr-2 w-4 h-4" />
                    Zerar não lidas de grupos ({unreadGroupCount})
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                </span>
              )}
              {onToggleArchived && (
                <DropdownMenuItem onClick={onToggleArchived}>
                  {showArchived ? (
                    <span className="inline-flex items-center">
                      <ArchiveRestore className="mr-2 w-4 h-4" />
                      Ocultar arquivadas
                    </span>
                  ) : (
                    <span className="inline-flex items-center">
                      <Archive className="mr-2 w-4 h-4" />
                      Mostrar arquivadas
                    </span>
                  )}
                </DropdownMenuItem>
              )}
              {onRefresh && (
                <DropdownMenuItem onClick={onRefresh}>
                  <RefreshCw className="mr-2 w-4 h-4" />
                  Atualizar lista
                </DropdownMenuItem>
              )}

              {hasOwnerActions && <DropdownMenuSeparator />}

              {onReimportHistory && (
                <DropdownMenuItem onClick={onReimportHistory}>
                  <History className="mr-2 w-4 h-4 text-amber-600" />
                  Reimportar histórico
                </DropdownMenuItem>
              )}
              {onDiagnose && (
                <DropdownMenuItem onClick={onDiagnose}>
                  <Wrench className="mr-2 w-4 h-4 text-blue-600" />
                  Diagnosticar webhook
                </DropdownMenuItem>
              )}
              {onDisconnect && (
                <DropdownMenuItem onClick={onDisconnect}>
                  <LogOut className="mr-2 w-4 h-4 text-muted-foreground" />
                  Desconectar WhatsApp
                </DropdownMenuItem>
              )}
              {onFactoryReset && (
                <span className="contents">
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={onFactoryReset}
                    className="text-destructive focus:bg-destructive/10 focus:text-destructive"
                  >
                    <Trash2 className="mr-2 w-4 h-4" />
                    Apagar conta
                  </DropdownMenuItem>
                </span>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Abas de filtro: Todas, Pacientes (diretas), Grupos */}
        <div className="flex items-center justify-between gap-1 border-b border-border/40 pb-2">
          <div className="flex items-center gap-1">
            <button
              onClick={() => setChatTypeFilter('all')}
              className={cn(
                'px-2.5 py-1 text-xs rounded-lg font-medium transition-colors',
                chatTypeFilter === 'all'
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'text-muted-foreground hover:bg-black/5',
              )}
            >
              Todas
            </button>
            <button
              onClick={() => setChatTypeFilter('direct')}
              className={cn(
                'flex items-center gap-1 px-2.5 py-1 text-xs rounded-lg font-medium transition-colors',
                chatTypeFilter === 'direct'
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'text-muted-foreground hover:bg-black/5',
              )}
            >
              <User className="w-3.5 h-3.5" />
              Pacientes
            </button>
            <button
              onClick={() => setChatTypeFilter('group')}
              className={cn(
                'flex items-center gap-1 px-2.5 py-1 text-xs rounded-lg font-medium transition-colors',
                chatTypeFilter === 'group'
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'text-muted-foreground hover:bg-black/5',
              )}
            >
              <Users className="w-3.5 h-3.5" />
              Grupos
              {unreadGroupCount > 0 && (
                <span className="ml-1 px-1.5 py-0.2 text-[10px] rounded-full bg-emerald-500 text-white font-bold">
                  {unreadGroupCount}
                </span>
              )}
            </button>
          </div>

          {chatTypeFilter === 'group' && unreadGroupCount > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleClearAllGroupUnreads}
              disabled={isClearingGroupUnreads}
              className="h-6 px-2 text-[10px] font-medium text-emerald-700 hover:text-emerald-800 hover:bg-emerald-50 border-emerald-200"
            >
              {isClearingGroupUnreads ? (
                <Loader2 className="w-3 h-3 animate-spin mr-1" />
              ) : (
                <CheckCheck className="w-3 h-3 mr-1" />
              )}
              Zerar não lidas
            </Button>
          )}
        </div>

        {categories.length > 0 && (
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none">
            {selectedCategory && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setSelectedCategory(null)}
                className="h-6 px-2 text-[10px] uppercase font-bold text-muted-foreground hover:bg-black/5 shrink-0 rounded-full"
              >
                Limpar
              </Button>
            )}
            {categories.map((cat) => (
              <button
                key={cat.id}
                onClick={() => setSelectedCategory((prev) => (prev === cat.id ? null : cat.id))}
                className={cn(
                  'flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-all whitespace-nowrap shrink-0 border',
                  selectedCategory === cat.id
                    ? cn('border-transparent text-white shadow-sm', CATEGORY_COLOR_MAP[cat.color])
                    : 'bg-white border-border text-foreground hover:bg-black/5',
                )}
              >
                {!selectedCategory || selectedCategory !== cat.id ? (
                  <div className={cn('w-1.5 h-1.5 rounded-full', CATEGORY_COLOR_MAP[cat.color])} />
                ) : null}
                {cat.name}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto overflow-x-hidden">
        {showSkeleton ? (
          <div className="divide-y divide-border/50">
            {Array.from({ length: SKELETON_ROWS }).map((_, i) => (
              <ChatRowSkeleton key={i} />
            ))}
          </div>
        ) : error && safeChats.length === 0 ? (
          <div className="p-6 m-4 border border-rose-200 bg-rose-50/40 rounded-xl text-center flex flex-col items-center justify-center space-y-3">
            <AlertTriangle className="w-10 h-10 text-rose-600" />
            <h4 className="font-serif font-bold text-sm text-rose-900">
              Não foi possível carregar. Tentar de novo
            </h4>
            <p className="text-xs text-rose-700 max-w-xs">
              {error || 'Houve uma falha ao conectar ao banco de dados.'}
            </p>
            {onRefresh && (
              <Button
                variant="outline"
                size="sm"
                onClick={onRefresh}
                className="h-8 text-xs border-rose-300 text-rose-800 hover:bg-rose-100"
              >
                <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
                Tentar de novo
              </Button>
            )}
          </div>
        ) : showEmpty ? (
          <div className="p-8 text-center text-muted-foreground flex flex-col items-center">
            <MessageCircle className="w-12 h-12 mb-4 opacity-20" />
            <p>
              {pendingCount > 0
                ? 'Sincronizando suas conversas...'
                : 'Nenhuma conversa encontrada.'}
            </p>
          </div>
        ) : showNoMatches ? (
          <div className="p-8 text-center text-muted-foreground flex flex-col items-center">
            <Search className="w-10 h-10 mb-4 opacity-20" />
            <p className="text-sm">Nenhuma conversa corresponde à busca.</p>
          </div>
        ) : (
          <div className="divide-y divide-border/50">
            {filteredChats.map((chat) => (
              <ChatRow
                key={chat.id}
                chat={chat}
                isActive={activeChatId === chat.id}
                onSelectChat={onSelectChat}
                onMarkAsRead={handleMarkAsRead}
                onFinalizeChat={handleFinalizeChat}
                messagePreview={messageMatchPreviews?.get(chat.remote_jid || '')}
              />
            ))}
          </div>
        )}
      </div>

      {pendingCount > 0 ? (
        <div className="px-4 py-3 border-t border-border/50 flex items-center gap-2 text-xs text-muted-foreground bg-background/40 shrink-0">
          <Loader2 className="w-3.5 h-3.5 animate-spin opacity-70 shrink-0" />
          <span className="truncate">
            Sincronizando {pendingCount} conversa{pendingCount > 1 ? 's' : ''}...
          </span>
        </div>
      ) : isCurrentlyLoadingMore ? (
        <div className="px-4 py-3 border-t border-border/50 flex items-center justify-center gap-2 text-xs text-muted-foreground bg-background/40 shrink-0">
          <Loader2 className="w-4 h-4 animate-spin text-primary shrink-0" />
          <span className="truncate font-medium text-primary">Carregando conversas...</span>
        </div>
      ) : canLoadMore ? (
        <div className="p-3 border-t border-border/50 flex justify-center bg-background/40 shrink-0">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              if (onLoadMore) onLoadMore()
              else document.dispatchEvent(new CustomEvent('triggerLoadMoreConversations'))
            }}
            className="w-full rounded-xl hover:bg-primary/5 hover:text-primary hover:border-primary/30 transition-colors"
          >
            Carregar mais conversas
          </Button>
        </div>
      ) : null}
    </div>
  )
}
