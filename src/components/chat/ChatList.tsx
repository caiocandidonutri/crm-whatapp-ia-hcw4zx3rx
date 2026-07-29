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
} from 'lucide-react'
import { Chat } from '@/lib/mock-data'
import { cn } from '@/lib/utils'
import { formatChatListTimestamp } from '@/lib/format-time'
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
  pendingCount?: number
  loadingMore?: boolean
  showArchived?: boolean
  hasMore?: boolean
  onLoadMore?: () => void
  onToggleArchived?: () => void
  // Callbacks para ações do menu — só aparecem se definidos
  onRefresh?: () => void
  onReimportHistory?: () => void
  onDiagnose?: () => void
  onDisconnect?: () => void
  onFactoryReset?: () => void
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

export function ChatList({
  chats,
  activeChatId,
  onSelectChat,
  className,
  loading = false,
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
}: ChatListProps) {
  const safeChats = chats || []
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null)

  const { account } = useCurrentAccount()
  const { categories } = useCategories(account?.id)

  const filteredChats = useMemo(() => {
    let filtered = safeChats.filter((c) => !!c)

    if (selectedCategory) {
      filtered = filtered.filter((c) => c.category_ids?.includes(selectedCategory))
    }

    if (searchTerm.trim()) {
      const q = searchTerm.toLowerCase().trim()
      filtered = filtered.filter((c) => {
        const haystack = `${c.name || ''} ${c.phone || ''}`.toLowerCase()
        return haystack.includes(q)
      })
    }

    return filtered
  }, [safeChats, searchTerm, selectedCategory])

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

  return (
    <div className={cn('flex flex-col h-full bg-white border-r border-border', className)}>
      <div className="p-4 border-b border-border flex flex-col gap-4 bg-background/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Buscar conversa..."
              className="pl-9 bg-white border-border rounded-xl"
            />
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon" className="rounded-xl shrink-0">
                <MoreVertical className="w-4 h-4 text-muted-foreground" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              {onToggleArchived && (
                <DropdownMenuItem onClick={onToggleArchived}>
                  {showArchived ? (
                    <>
                      <ArchiveRestore className="mr-2 w-4 h-4" />
                      Ocultar arquivadas
                    </>
                  ) : (
                    <>
                      <Archive className="mr-2 w-4 h-4" />
                      Mostrar arquivadas
                    </>
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
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={onFactoryReset}
                    className="text-destructive focus:bg-destructive/10 focus:text-destructive"
                  >
                    <Trash2 className="mr-2 w-4 h-4" />
                    Apagar conta
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Category Filters */}
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
            {filteredChats.map((chat) => {
              if (!chat) return null
              const lastMsg = chat.messages?.[(chat.messages?.length || 0) - 1] ?? null
              const isActive = activeChatId === chat.id
              const unreadCount = chat.unread || 0
              const hasAvatar = !!chat.avatar

              return (
                <button
                  key={chat.id}
                  onClick={() => onSelectChat(chat.id)}
                  className={cn(
                    'w-full p-4 flex items-center gap-3 transition-colors text-left relative overflow-hidden',
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
                          {chat.name || 'Sem nome'}
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
                          unreadCount > 0
                            ? 'text-emerald-600 font-semibold'
                            : 'text-muted-foreground',
                        )}
                      >
                        {formatChatListTimestamp(chat.lastMessage?.timestamp || lastMsg?.timestamp)}
                      </span>
                    </div>

                    <div className="flex items-center justify-between gap-2 min-w-0">
                      <div
                        className={cn(
                          'text-sm truncate flex items-center gap-1 min-w-0',
                          unreadCount > 0 ? 'text-foreground font-medium' : 'text-muted-foreground',
                        )}
                      >
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

                          if (isPhoto)
                            return <ImageIcon className="w-3.5 h-3.5 shrink-0 opacity-70" />
                          if (isVideo) return <Video className="w-3.5 h-3.5 shrink-0 opacity-70" />
                          if (isAudio) return <Mic className="w-3.5 h-3.5 shrink-0 opacity-70" />
                          if (isDoc) return <FileText className="w-3.5 h-3.5 shrink-0 opacity-70" />
                          if (isSticker)
                            return <Sticker className="w-3.5 h-3.5 shrink-0 opacity-70" />
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
                          {chat.lastMessage?.text ||
                            lastMsg?.text ||
                            (lastMsg?.media ? 'Mídia' : '')}
                        </span>
                      </div>
                      {unreadCount > 0 && (
                        <div className="bg-emerald-500 text-white text-[10px] font-bold h-5 min-w-[20px] px-1.5 rounded-full flex items-center justify-center shrink-0">
                          {unreadCount}
                        </div>
                      )}
                    </div>
                  </div>
                </button>
              )
            })}
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
