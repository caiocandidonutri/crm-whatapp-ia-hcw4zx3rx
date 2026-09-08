import { useNavigate } from 'react-router-dom'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import {
  MessageCircle,
  CalendarIcon,
  Paperclip,
  MoreVertical,
  Trash2,
  CheckCircle,
  Heart,
} from 'lucide-react'
import pb from '@/lib/pocketbase/client'
import { Task } from '@/types/models'
import { cn } from '@/lib/utils'
import { getPriorityMeta, getCareCategoryMeta } from '@/lib/task-meta'
import { resolveDisplayName, formatPhoneBR } from '@/lib/phone'
import { updateTask, deleteTask } from '@/services/tasks'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

interface CareTaskCardProps {
  task: Task
  isDragging: boolean
  onDragStart: (e: React.DragEvent, id: string) => void
  onClick: () => void
  onDelete: () => void
  onComplete: () => void
  onOpenSecretary: () => void
  selected?: boolean
  onToggleSelect?: (id: string, selected: boolean) => void
  selectionMode?: boolean
}

export function CareTaskCard({
  task,
  isDragging,
  onDragStart,
  onClick,
  onDelete,
  onComplete,
  onOpenSecretary,
  selected = false,
  onToggleSelect,
  selectionMode = false,
}: CareTaskCardProps) {
  const selectable = !!onToggleSelect
  const priorityMeta = getPriorityMeta(task.priority)
  const navigate = useNavigate()
  const assignedUser = task.expand?.assigned_to
  const crmContact = task.expand?.crm_contact_id
  const conversation = task.expand?.conversation_id

  const careCategory = task.care_category || 'sem_categoria'
  const careMeta = getCareCategoryMeta(careCategory)
  const isCareTask = careCategory !== 'sem_categoria'

  const patientName = resolveDisplayName(
    crmContact?.contact_name,
    crmContact?.jid || crmContact?.phone,
    crmContact?.push_name || task.title,
  )

  const phone = crmContact?.phone || crmContact?.jid?.split('@')[0] || ''

  const linkedCount = task.linked_message_ids
    ? Array.isArray(task.linked_message_ids)
      ? task.linked_message_ids.length
      : 1
    : 0

  return (
    <Card
      className={cn(
        'p-3 cursor-pointer hover:shadow-md transition-all group bg-background border shadow-sm relative active:cursor-grabbing',
        isDragging && 'opacity-50 scale-95 shadow-none',
      )}
      draggable
      onDragStart={(e) => onDragStart(e, task.id)}
      onClick={onClick}
    >
      {selectable && (
        <div
          className="absolute left-2 top-2 z-10"
          onClick={(e) => {
            e.stopPropagation()
            onToggleSelect(task.id, !selected)
          }}
          onMouseDown={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <Checkbox
            checked={selected}
            className={cn(
              'transition-opacity',
              selectionMode || selected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
            )}
          />
        </div>
      )}
      <div className="flex justify-between items-start mb-2">
        <div className={cn('flex flex-wrap items-center gap-1', selectable && 'ml-6')}>
          {isCareTask && (
            <Badge
              variant="outline"
              className={cn(
                'text-[10px] font-medium px-1.5 py-0 border-transparent',
                careMeta.color,
              )}
            >
              {careMeta.emoji} {careMeta.label}
            </Badge>
          )}
          <Badge
            variant="outline"
            className={cn(
              'text-[10px] font-medium px-1.5 py-0 border-transparent',
              priorityMeta.color,
            )}
          >
            {priorityMeta.label}
          </Badge>
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 -mr-1 opacity-0 group-hover:opacity-100 text-muted-foreground focus:opacity-100"
              onClick={(e) => e.stopPropagation()}
            >
              <MoreVertical className="w-4 h-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            {task.status !== 'concluida' && (
              <DropdownMenuItem
                onClick={(e) => {
                  e.stopPropagation()
                  onComplete()
                }}
              >
                <CheckCircle className="w-4 h-4 mr-2 text-emerald-600" /> Concluir
              </DropdownMenuItem>
            )}
            {isCareTask && (
              <DropdownMenuItem
                onClick={(e) => {
                  e.stopPropagation()
                  onOpenSecretary()
                }}
              >
                <Heart className="w-4 h-4 mr-2 text-rose-500" /> Secretária
              </DropdownMenuItem>
            )}
            <DropdownMenuItem
              className="text-destructive focus:bg-destructive focus:text-destructive-foreground"
              onClick={(e) => {
                e.stopPropagation()
                onDelete()
              }}
            >
              <Trash2 className="w-4 h-4 mr-2" /> Excluir
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <h4 className="text-sm font-semibold leading-tight mb-1">{task.title}</h4>

      {isCareTask && crmContact?.ai_suggested_action && (
        <p className="text-xs text-muted-foreground line-clamp-2 mb-2 italic">
          💡 {crmContact.ai_suggested_action}
        </p>
      )}

      {task.description && !isCareTask && (
        <div
          className="text-xs text-muted-foreground line-clamp-2 mb-2 [&>p]:m-0 [&>*]:m-0"
          dangerouslySetInnerHTML={{ __html: task.description }}
        />
      )}

      <div className="flex items-center justify-between text-xs text-muted-foreground mt-2 border-t pt-2">
        <div className="flex items-center gap-2">
          {assignedUser && (
            <Avatar
              className="w-5 h-5 border shadow-sm"
              title={`Responsável: ${assignedUser.name || assignedUser.email}`}
            >
              <AvatarImage
                src={
                  assignedUser.avatar
                    ? pb.files.getUrl(assignedUser, assignedUser.avatar, { thumb: '100x100' })
                    : undefined
                }
              />
              <AvatarFallback className="text-[9px] bg-primary/10 text-primary">
                {assignedUser.name?.charAt(0) || assignedUser.email?.charAt(0)}
              </AvatarFallback>
            </Avatar>
          )}
          {task.due_date && (
            <div
              className="flex items-center gap-1 bg-muted px-1.5 py-0.5 rounded-md"
              title="Vencimento"
            >
              <CalendarIcon className="w-3 h-3" />
              {format(new Date(task.due_date), 'dd/MM', { locale: ptBR })}
            </div>
          )}
          {linkedCount > 0 && (
            <div
              className="flex items-center gap-1 bg-muted px-1.5 py-0.5 rounded-md"
              title={`${linkedCount} mensagem(ns) vinculada(s)`}
            >
              <Paperclip className="w-3 h-3" />
              {linkedCount}
            </div>
          )}
        </div>

        <div className="flex items-center gap-1">
          {phone && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-[10px] opacity-0 group-hover:opacity-100 transition-opacity bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
              onClick={(e) => {
                e.stopPropagation()
                window.open(`https://wa.me/${phone.replace(/\D/g, '')}`, '_blank')
              }}
            >
              <MessageCircle className="w-3 h-3 mr-1" />
              WhatsApp
            </Button>
          )}
          {task.conversation_id && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-[10px] opacity-0 group-hover:opacity-100 transition-opacity bg-primary/5 text-primary hover:bg-primary/10"
              onClick={(e) => {
                e.stopPropagation()
                const msgParam =
                  task.linked_message_ids &&
                  Array.isArray(task.linked_message_ids) &&
                  task.linked_message_ids.length > 0
                    ? `&msg=${task.linked_message_ids[0]}`
                    : ''
                navigate(`/conversas?chat=${task.conversation_id}${msgParam}`)
              }}
            >
              <MessageCircle className="w-3 h-3 mr-1" />
              Conversa
            </Button>
          )}
        </div>
      </div>
    </Card>
  )
}
