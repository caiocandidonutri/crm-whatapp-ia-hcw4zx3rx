import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog'
import { Task } from '@/types/models'
import { getStatusMeta, getPriorityMeta } from '@/lib/task-meta'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import {
  CalendarIcon,
  MessageCircle,
  Paperclip,
  CheckCircle,
  Trash2,
  UserCircle2,
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { updateTask, deleteTask } from '@/services/tasks'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useTeamMembers } from '@/hooks/use-team-members'
import pb from '@/lib/pocketbase/client'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'

interface Props {
  task: Task | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function TaskViewDialog({ task, open, onOpenChange }: Props) {
  const navigate = useNavigate()
  const { members, loading: loadingMembers } = useTeamMembers()

  if (!task) return null

  const statusMeta = getStatusMeta(task.status)
  const priorityMeta = getPriorityMeta(task.priority)
  const linkedCount = task.linked_message_ids
    ? Array.isArray(task.linked_message_ids)
      ? task.linked_message_ids.length
      : 1
    : 0

  const handleComplete = async () => {
    await updateTask(task.id, { status: 'concluida', completed_at: new Date().toISOString() })
    onOpenChange(false)
  }

  const handleDelete = async () => {
    await deleteTask(task.id)
    onOpenChange(false)
  }

  const handleNavigate = () => {
    onOpenChange(false)
    if (task.conversation_id) {
      const msgParam =
        task.linked_message_ids &&
        Array.isArray(task.linked_message_ids) &&
        task.linked_message_ids.length > 0
          ? `&msg=${task.linked_message_ids[0]}`
          : ''
      navigate(`/conversas?chat=${task.conversation_id}${msgParam}`)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col p-0">
        <DialogHeader className="shrink-0 px-6 pt-6 pb-4 border-b">
          <div className="flex items-center gap-2 mb-3">
            <Badge variant="outline" className={statusMeta.color}>
              {statusMeta.label}
            </Badge>
            <Badge variant="outline" className={priorityMeta.color}>
              {priorityMeta.label}
            </Badge>
          </div>
          <DialogTitle className="text-xl">{task.title}</DialogTitle>
          <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground mt-2">
            {task.due_date && (
              <span className="flex items-center gap-1">
                <CalendarIcon className="w-4 h-4" />
                Vencimento: {format(new Date(task.due_date), 'PPP', { locale: ptBR })}
              </span>
            )}
            {linkedCount > 0 && (
              <span className="flex items-center gap-1">
                <Paperclip className="w-4 h-4" />
                {linkedCount} mensagem(ns) vinculada(s)
              </span>
            )}
          </div>
        </DialogHeader>

        <ScrollArea className="flex-1 px-6 py-4">
          <div className="mb-6 flex flex-col gap-2">
            <h4 className="text-sm font-semibold">Responsável</h4>
            <Select
              value={task.assigned_to || 'unassigned'}
              onValueChange={async (val) => {
                await updateTask(task.id, { assigned_to: val === 'unassigned' ? '' : val })
              }}
              disabled={loadingMembers}
            >
              <SelectTrigger className="w-full sm:w-[250px]">
                <SelectValue placeholder="Sem responsável" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="unassigned">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <UserCircle2 className="w-4 h-4" />
                    <span>Ninguém</span>
                  </div>
                </SelectItem>
                {members.map((member) => {
                  const user = member.expand?.user_id
                  if (!user) return null
                  return (
                    <SelectItem key={user.id} value={user.id}>
                      <div className="flex items-center gap-2">
                        <Avatar className="w-5 h-5">
                          <AvatarImage
                            src={
                              user.avatar
                                ? pb.files.getUrl(user, user.avatar, { thumb: '100x100' })
                                : undefined
                            }
                          />
                          <AvatarFallback className="text-[9px]">
                            {user.name?.charAt(0) || user.email?.charAt(0)}
                          </AvatarFallback>
                        </Avatar>
                        <span className="truncate max-w-[150px]">{user.name || user.email}</span>
                      </div>
                    </SelectItem>
                  )
                })}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-6">
            <div>
              <h4 className="text-sm font-semibold mb-2">Descrição</h4>
              {task.description ? (
                <div
                  className="prose prose-sm dark:prose-invert max-w-none text-foreground"
                  dangerouslySetInnerHTML={{ __html: task.description }}
                />
              ) : (
                <p className="text-sm text-muted-foreground italic">Nenhuma descrição fornecida.</p>
              )}
            </div>
          </div>
        </ScrollArea>

        <DialogFooter className="shrink-0 px-6 py-4 border-t flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2 w-full sm:w-auto">
            {task.conversation_id && (
              <Button variant="outline" onClick={handleNavigate} className="flex-1 sm:flex-none">
                <MessageCircle className="w-4 h-4 mr-2" />
                Ver na conversa
              </Button>
            )}
            {task.status !== 'concluida' && (
              <Button variant="default" onClick={handleComplete} className="flex-1 sm:flex-none">
                <CheckCircle className="w-4 h-4 mr-2" />
                Concluir
              </Button>
            )}
          </div>
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <Button
              variant="ghost"
              className="text-destructive hover:bg-destructive/10 hover:text-destructive flex-1 sm:flex-none"
              onClick={handleDelete}
            >
              <Trash2 className="w-4 h-4 mr-2" />
              Excluir
            </Button>
            <DialogClose asChild>
              <Button variant="secondary" className="flex-1 sm:flex-none">
                Fechar
              </Button>
            </DialogClose>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
