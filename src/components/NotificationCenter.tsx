import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Bell, MessageSquare, Heart, CheckSquare, CheckCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { useNotifications } from '@/hooks/use-notifications'
import { formatChatListTimestamp } from '@/lib/format-time'
import { Notification } from '@/types/models'

const ICON_MAP: Record<string, typeof Bell> = {
  message: MessageSquare,
  care_alert: Heart,
  task: CheckSquare,
}

const COLOR_MAP: Record<string, string> = {
  message: 'text-emerald-600 bg-emerald-50',
  care_alert: 'text-rose-600 bg-rose-50',
  task: 'text-blue-600 bg-blue-50',
}

export function NotificationCenter() {
  const navigate = useNavigate()
  const { notifications, unreadCount, loading, markAsRead, markAllAsRead } = useNotifications()
  const [open, setOpen] = useState(false)

  const handleClick = (notif: Notification) => {
    markAsRead(notif.id)
    setOpen(false)
    if (notif.type === 'message' && notif.conversation_id) {
      navigate(`/conversas?chat=${notif.conversation_id}`)
    } else if (notif.type === 'care_alert') {
      if (notif.conversation_id) {
        navigate(`/conversas?chat=${notif.conversation_id}`)
      } else if (notif.crm_contact_id) {
        navigate(`/crm?contact=${notif.crm_contact_id}`)
      }
    } else if (notif.type === 'task' && notif.task_id) {
      navigate('/tarefas')
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative rounded-full">
          <Bell className="w-5 h-5 text-muted-foreground" />
          {unreadCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold flex items-center justify-center">
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 sm:w-96 p-0 rounded-2xl" align="end">
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <h3 className="font-semibold text-sm">Notificações</h3>
          {unreadCount > 0 && (
            <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={markAllAsRead}>
              <CheckCheck className="w-3.5 h-3.5 mr-1" />
              Marcar todas
            </Button>
          )}
        </div>
        <ScrollArea className="h-[400px]">
          {loading ? (
            <div className="p-4 space-y-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-16 w-full rounded-xl" />
              ))}
            </div>
          ) : notifications.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground text-sm">
              <Bell className="w-8 h-8 mx-auto mb-2 opacity-20" />
              Nenhuma notificação
            </div>
          ) : (
            <div className="flex flex-col">
              {notifications.map((notif) => {
                const Icon = ICON_MAP[notif.type] || Bell
                const colorClass = COLOR_MAP[notif.type] || ''
                return (
                  <button
                    key={notif.id}
                    onClick={() => handleClick(notif)}
                    className={cn(
                      'flex items-start gap-3 px-4 py-3 text-left hover:bg-muted/50 transition-colors border-b last:border-b-0',
                      !notif.read && 'bg-primary/5',
                    )}
                  >
                    <div className={cn('p-2 rounded-lg shrink-0', colorClass)}>
                      <Icon className="w-4 h-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className={cn('text-sm truncate', !notif.read && 'font-semibold')}>
                        {notif.title}
                      </p>
                      {notif.body && (
                        <p className="text-xs text-muted-foreground truncate">{notif.body}</p>
                      )}
                      <p className="text-[10px] text-muted-foreground/70 mt-0.5">
                        {formatChatListTimestamp(notif.created)}
                      </p>
                    </div>
                    {!notif.read && (
                      <div className="w-2 h-2 rounded-full bg-primary shrink-0 mt-1.5" />
                    )}
                  </button>
                )
              })}
            </div>
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  )
}
