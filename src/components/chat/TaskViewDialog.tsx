import { useState } from 'react'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { CheckCircle2, Circle, Clock, Trash2, Loader2, AlertCircle } from 'lucide-react'
import { Task } from '@/types/models'
import { updateTask, deleteTask } from '@/services/tasks'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'

const statusConfig: Record<string, { label: string; class: string }> = {
  pendente: { label: 'Pendente', class: 'bg-slate-100 text-slate-700 border-slate-200' },
  em_andamento: { label: 'Em andamento', class: 'bg-amber-100 text-amber-700 border-amber-200' },
  concluida: { label: 'Concluída', class: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
  cancelada: { label: 'Cancelada', class: 'bg-rose-100 text-rose-700 border-rose-200' },
}

const priorityConfig: Record<string, { label: string; class: string }> = {
  baixa: { label: 'Baixa', class: 'text-slate-500 border-slate-200 bg-white' },
  media: { label: 'Média', class: 'text-amber-600 border-amber-200 bg-amber-50/50' },
  alta: { label: 'Alta', class: 'text-orange-600 border-orange-200 bg-orange-50/50' },
  urgente: { label: 'Urgente', class: 'text-rose-600 border-rose-200 bg-rose-50/50 font-bold' },
}

function TaskCard({ task, onDelete }: { task: Task; onDelete: (t: Task) => void }) {
  const [isToggling, setIsToggling] = useState(false)
  const isCompleted = task.status === 'concluida'

  const handleToggleCompletion = async () => {
    setIsToggling(true)
    try {
      if (isCompleted) {
        await updateTask(task.id, { status: 'pendente', completed_at: '' })
        toast.success('Tarefa reaberta')
      } else {
        await updateTask(task.id, {
          status: 'concluida',
          completed_at: new Date().toISOString(),
        })
        toast.success('Tarefa concluída')
      }
    } catch (err: any) {
      toast.error('Erro ao atualizar tarefa')
    } finally {
      setIsToggling(false)
    }
  }

  const sConf = statusConfig[task.status] || statusConfig.pendente
  const pConf = priorityConfig[task.priority] || priorityConfig.media

  return (
    <div className="flex flex-col gap-3 p-4 bg-white rounded-xl border border-border/50 shadow-sm relative group overflow-hidden">
      <div className="flex justify-between items-start gap-4">
        <div className="flex flex-col gap-1 min-w-0">
          <h4
            className={cn(
              'font-semibold text-base leading-tight',
              isCompleted && 'line-through opacity-70',
            )}
          >
            {task.title}
          </h4>
          <div className="flex flex-wrap items-center gap-2 mt-1">
            <Badge variant="outline" className={cn('font-medium', sConf.class)}>
              {sConf.label}
            </Badge>
            <Badge variant="outline" className={cn('font-medium', pConf.class)}>
              {pConf.label}
            </Badge>
            {task.due_date && (
              <span className="text-xs text-muted-foreground flex items-center gap-1 font-medium bg-muted/50 px-2 py-0.5 rounded-full border border-border/50">
                <Clock className="w-3 h-3" />
                {format(new Date(task.due_date), "dd 'de' MMM, HH:mm", { locale: ptBR })}
              </span>
            )}
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => onDelete(task)}
          className="shrink-0 text-muted-foreground hover:text-destructive hover:bg-destructive/10 -mt-1 -mr-1 h-8 w-8"
        >
          <Trash2 className="w-4 h-4" />
        </Button>
      </div>

      {task.description && (
        <>
          <Separator className="bg-border/50" />
          <div
            className="text-sm text-foreground/80 prose prose-sm max-w-none prose-p:leading-snug prose-p:my-1"
            dangerouslySetInnerHTML={{ __html: task.description }}
          />
        </>
      )}

      <div className="flex items-center justify-end mt-1">
        <Button
          variant={isCompleted ? 'outline' : 'default'}
          size="sm"
          className={cn(
            'rounded-full h-8 px-4 text-xs font-semibold shadow-none',
            isCompleted && 'border-emerald-200 text-emerald-700 hover:bg-emerald-50',
          )}
          disabled={isToggling}
          onClick={handleToggleCompletion}
        >
          {isToggling ? (
            <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
          ) : isCompleted ? (
            <CheckCircle2 className="w-3.5 h-3.5 mr-1.5" />
          ) : (
            <Circle className="w-3.5 h-3.5 mr-1.5" />
          )}
          {isCompleted ? 'Concluída' : 'Marcar como concluída'}
        </Button>
      </div>
    </div>
  )
}

export function TaskViewDialog({
  open,
  onOpenChange,
  tasks,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  tasks: Task[]
}) {
  const [taskToDelete, setTaskToDelete] = useState<Task | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)

  const handleDeleteConfirm = async () => {
    if (!taskToDelete) return
    setIsDeleting(true)
    try {
      await deleteTask(taskToDelete.id)
      toast.success('Tarefa excluída')
      if (tasks.length === 1) {
        onOpenChange(false)
      }
    } catch (err: any) {
      toast.error('Erro ao excluir tarefa')
    } finally {
      setIsDeleting(false)
      setTaskToDelete(null)
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-lg p-0 overflow-hidden bg-muted/20 border-border shadow-lg">
          <DialogHeader className="p-5 pb-3 bg-white border-b border-border/50">
            <DialogTitle className="flex items-center gap-2 text-lg">
              <AlertCircle className="w-5 h-5 text-primary" />
              Tarefas Vinculadas
            </DialogTitle>
            <DialogDescription>
              {tasks.length} {tasks.length === 1 ? 'tarefa referenciada' : 'tarefas referenciadas'}{' '}
              nesta mensagem.
            </DialogDescription>
          </DialogHeader>

          <ScrollArea className="max-h-[60vh] px-5 py-4">
            <div className="flex flex-col gap-4">
              {tasks.map((task) => (
                <TaskCard key={task.id} task={task} onDelete={setTaskToDelete} />
              ))}
              {tasks.length === 0 && (
                <div className="text-center py-8 text-muted-foreground text-sm">
                  Nenhuma tarefa encontrada.
                </div>
              )}
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!taskToDelete} onOpenChange={(open) => !open && setTaskToDelete(null)}>
        <AlertDialogContent className="sm:max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir tarefa?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação não pode ser desfeita. A tarefa "{taskToDelete?.title}" será permanentemente
              removida.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault()
                handleDeleteConfirm()
              }}
              disabled={isDeleting}
              className="bg-destructive hover:bg-destructive/90 text-destructive-foreground"
            >
              {isDeleting ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Trash2 className="w-4 h-4 mr-2" />
              )}
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
