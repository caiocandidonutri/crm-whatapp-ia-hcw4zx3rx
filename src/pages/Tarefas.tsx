import { useState, useMemo } from 'react'
import { useTasks } from '@/hooks/use-tasks'
import { TASK_STATUSES, TASK_PRIORITIES, getPriorityMeta } from '@/lib/task-meta'
import { Task } from '@/types/models'
import pb from '@/lib/pocketbase/client'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { updateTask, deleteTask } from '@/services/tasks'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Search,
  MessageCircle,
  CalendarIcon,
  Paperclip,
  MoreVertical,
  Trash2,
  CheckCircle,
} from 'lucide-react'
import { format } from 'date-fns'
import { useNavigate } from 'react-router-dom'
import { cn } from '@/lib/utils'
import { TaskViewDialog } from '@/components/TaskViewDialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

export default function Tarefas() {
  const { tasks, loading } = useTasks()
  const [search, setSearch] = useState('')
  const [priorityFilter, setPriorityFilter] = useState('todas')
  const [filterMine, setFilterMine] = useState(false)
  const [draggedTaskId, setDraggedTaskId] = useState<string | null>(null)
  const [dragOverColumn, setDragOverColumn] = useState<string | null>(null)

  const [selectedTask, setSelectedTask] = useState<Task | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)

  const filteredTasks = useMemo(() => {
    return tasks.filter((t) => {
      const matchSearch =
        t.title.toLowerCase().includes(search.toLowerCase()) ||
        (t.description || '').toLowerCase().includes(search.toLowerCase())
      const matchPriority = priorityFilter === 'todas' || t.priority === priorityFilter
      const matchMine = !filterMine || t.assigned_to === pb.authStore.record?.id
      return matchSearch && matchPriority && matchMine
    })
  }, [tasks, search, priorityFilter, filterMine])

  const kpis = useMemo(() => {
    const total = tasks.length
    const byStatus = TASK_STATUSES.reduce(
      (acc, status) => {
        acc[status.id] = tasks.filter((t) => t.status === status.id).length
        return acc
      },
      {} as Record<string, number>,
    )
    return { total, byStatus }
  }, [tasks])

  const handleDragStart = (e: React.DragEvent, id: string) => {
    e.dataTransfer.setData('taskId', id)
    setDraggedTaskId(id)
  }

  const handleDragOver = (e: React.DragEvent, statusId: string) => {
    e.preventDefault()
    setDragOverColumn(statusId)
  }

  const handleDragLeave = () => {
    setDragOverColumn(null)
  }

  const handleDrop = async (e: React.DragEvent, statusId: string) => {
    e.preventDefault()
    setDragOverColumn(null)
    setDraggedTaskId(null)
    const taskId = e.dataTransfer.getData('taskId')
    if (!taskId) return

    const task = tasks.find((t) => t.id === taskId)
    if (!task || task.status === statusId) return

    const updates: Partial<Task> = { status: statusId as any }
    if (statusId === 'concluida') {
      updates.completed_at = new Date().toISOString()
    }

    try {
      await updateTask(taskId, updates)
    } catch (err) {
      console.error('Failed to update task status', err)
    }
  }

  return (
    <div className="flex flex-col gap-6 h-full max-h-[calc(100vh-6rem)] overflow-hidden">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 shrink-0">
        <div>
          <h1 className="font-serif text-3xl font-bold text-primary">Tarefas</h1>
          <p className="text-muted-foreground mt-1">Gerencie as demandas da equipe.</p>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 shrink-0">
        <Card className="p-4 flex flex-col items-start justify-center bg-primary/5 border-primary/20">
          <span className="text-sm font-medium text-muted-foreground mb-1">Total</span>
          <span className="text-2xl font-bold">{loading ? '-' : kpis.total}</span>
        </Card>
        {TASK_STATUSES.map((s) => (
          <Card key={s.id} className="p-4 flex flex-col items-start justify-center">
            <span className="text-sm font-medium text-muted-foreground mb-1 flex items-center gap-2">
              <span className={cn('w-2 h-2 rounded-full', s.dot)} />
              {s.label}
            </span>
            <span className="text-2xl font-bold">{loading ? '-' : kpis.byStatus[s.id]}</span>
          </Card>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-4 shrink-0 items-center">
        <div className="flex items-center gap-2 bg-muted/50 p-1 rounded-lg border">
          <Button
            variant={!filterMine ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => setFilterMine(false)}
            className={cn('h-8 px-3 text-sm rounded-md', !filterMine && 'bg-background shadow-sm')}
          >
            Todas
          </Button>
          <Button
            variant={filterMine ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => setFilterMine(true)}
            className={cn('h-8 px-3 text-sm rounded-md', filterMine && 'bg-background shadow-sm')}
          >
            Minhas
          </Button>
        </div>
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Buscar tarefas..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 bg-background"
          />
        </div>
        <Select value={priorityFilter} onValueChange={setPriorityFilter}>
          <SelectTrigger className="w-full sm:w-[180px] bg-background">
            <SelectValue placeholder="Prioridade" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todas">Todas as prioridades</SelectItem>
            {TASK_PRIORITIES.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Kanban Board */}
      <div className="flex-1 overflow-x-auto overflow-y-hidden pb-4">
        <div className="flex gap-6 min-w-max h-full items-start">
          {TASK_STATUSES.map((status) => {
            const columnTasks = filteredTasks.filter((t) => t.status === status.id)
            const isDragOver = dragOverColumn === status.id

            return (
              <div
                key={status.id}
                className={cn(
                  'w-80 shrink-0 flex flex-col rounded-xl bg-muted/30 border h-full transition-all duration-200',
                  isDragOver ? 'border-primary bg-primary/5 scale-[1.02]' : 'border-transparent',
                )}
                onDragOver={(e) => handleDragOver(e, status.id)}
                onDragLeave={handleDragLeave}
                onDrop={(e) => handleDrop(e, status.id)}
              >
                <div className="p-3 font-semibold flex items-center justify-between border-b bg-white/50 backdrop-blur-sm rounded-t-xl shrink-0">
                  <div className="flex items-center gap-2">
                    <span className={cn('w-2 h-2 rounded-full', status.dot)} />
                    {status.label}
                  </div>
                  <Badge variant="secondary" className="px-1.5 py-0.5 text-xs bg-background">
                    {columnTasks.length}
                  </Badge>
                </div>

                <div className="p-3 flex flex-col gap-3 overflow-y-auto flex-1">
                  {columnTasks.length === 0 ? (
                    <div className="h-28 border-2 border-dashed rounded-xl flex items-center justify-center text-muted-foreground text-sm flex-col gap-2 opacity-50">
                      <status.icon className="w-5 h-5" />
                      Nenhuma tarefa
                    </div>
                  ) : (
                    columnTasks.map((task) => (
                      <TaskCard
                        key={task.id}
                        task={task}
                        isDragging={draggedTaskId === task.id}
                        onDragStart={handleDragStart}
                        onClick={() => {
                          setSelectedTask(task)
                          setDialogOpen(true)
                        }}
                        onDelete={async () => {
                          await deleteTask(task.id)
                        }}
                        onComplete={async () => {
                          await updateTask(task.id, {
                            status: 'concluida',
                            completed_at: new Date().toISOString(),
                          })
                        }}
                      />
                    ))
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      <TaskViewDialog open={dialogOpen} onOpenChange={setDialogOpen} task={selectedTask} />
    </div>
  )
}

function TaskCard({
  task,
  isDragging,
  onDragStart,
  onClick,
  onDelete,
  onComplete,
}: {
  task: Task
  isDragging: boolean
  onDragStart: (e: React.DragEvent, id: string) => void
  onClick: () => void
  onDelete: () => void
  onComplete: () => void
}) {
  const priorityMeta = getPriorityMeta(task.priority)
  const navigate = useNavigate()
  const assignedUser = task.expand?.assigned_to

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
      <div className="flex justify-between items-start mb-2">
        <Badge
          variant="outline"
          className={cn(
            'text-[10px] font-medium px-1.5 py-0 border-transparent',
            priorityMeta.color,
          )}
        >
          {priorityMeta.label}
        </Badge>

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
          <DropdownMenuContent align="end" className="w-40">
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

      <h4 className="text-sm font-semibold leading-tight mb-2">{task.title}</h4>

      {task.description && (
        <div
          className="text-xs text-muted-foreground line-clamp-2 mb-3 [&>p]:m-0 [&>*]:m-0"
          dangerouslySetInnerHTML={{ __html: task.description }}
        />
      )}

      <div className="flex items-center justify-between text-xs text-muted-foreground mt-3 border-t pt-3">
        <div className="flex items-center gap-3">
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
              {format(new Date(task.due_date), 'dd/MM')}
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
    </Card>
  )
}
