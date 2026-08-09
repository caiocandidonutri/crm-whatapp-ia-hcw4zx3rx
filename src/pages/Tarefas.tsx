import { useState, useMemo } from 'react'
import { useTasks } from '@/hooks/use-tasks'
import {
  TASK_STATUSES,
  TASK_PRIORITIES,
  CARE_CATEGORY_TABS,
  getCareCategoryMeta,
  getPriorityMeta,
  getStatusMeta,
} from '@/lib/task-meta'
import { downloadCsv, extractPhoneFromJid } from '@/lib/csv-export'
import { format } from 'date-fns'
import { Task } from '@/types/models'
import pb from '@/lib/pocketbase/client'
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
import { Search, Heart, Download, RefreshCw, X } from 'lucide-react'
import { toast } from 'sonner'
import { resyncCareTasks } from '@/services/crm_care_service'
import { cn } from '@/lib/utils'
import { TaskViewDialog } from '@/components/TaskViewDialog'
import { CareTaskCard } from '@/components/CareTaskCard'
import { CareSecretarySheet } from '@/components/CareSecretarySheet'
import { updateTask, deleteTask } from '@/services/tasks'

export default function Tarefas() {
  const { tasks, loading, loadTasks } = useTasks()
  const [search, setSearch] = useState('')
  const [priorityFilter, setPriorityFilter] = useState('todas')
  const [filterMine, setFilterMine] = useState(false)
  const [activeCategory, setActiveCategory] = useState('todos')
  const [draggedTaskId, setDraggedTaskId] = useState<string | null>(null)
  const [dragOverColumn, setDragOverColumn] = useState<string | null>(null)
  const [selectedTask, setSelectedTask] = useState<Task | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [secretaryOpen, setSecretaryOpen] = useState(false)
  const [secretaryContext, setSecretaryContext] = useState<Task | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [columnSearches, setColumnSearches] = useState<Record<string, string>>({})

  const handleResync = async () => {
    setSyncing(true)
    toast.info('Re-sincronizando categorias de cuidado...')
    try {
      const result = await resyncCareTasks()
      toast.success(
        `Sincronização concluída! ${result.tasks_created} criadas, ${result.tasks_updated} atualizadas, ${result.tasks_completed} concluídas.`,
      )
      loadTasks()
    } catch (err) {
      toast.error('Erro ao sincronizar. Tente novamente.')
    } finally {
      setSyncing(false)
    }
  }

  const filteredTasks = useMemo(() => {
    return tasks.filter((t) => {
      const matchSearch =
        t.title.toLowerCase().includes(search.toLowerCase()) ||
        (t.description || '').toLowerCase().includes(search.toLowerCase())
      const matchPriority = priorityFilter === 'todas' || t.priority === priorityFilter
      const matchMine = !filterMine || t.assigned_to === pb.authStore.record?.id
      const taskCareCategory = t.care_category || 'sem_categoria'
      const matchCategory = activeCategory === 'todos' || taskCareCategory === activeCategory
      return matchSearch && matchPriority && matchMine && matchCategory
    })
  }, [tasks, search, priorityFilter, filterMine, activeCategory])

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

  const openSecretary = (task: Task | null) => {
    setSecretaryContext(task)
    setSecretaryOpen(true)
  }

  const handleExportCsv = () => {
    const headers = [
      'Nome do Paciente',
      'Categoria de Cuidado',
      'Prioridade',
      'Status',
      'Ação Sugerida (IA)',
      'Data de Vencimento',
      'Telefone WhatsApp',
    ]

    const rows = filteredTasks.map((task) => {
      const contact = task.expand?.crm_contact_id
      const careMeta = getCareCategoryMeta(task.care_category || 'sem_categoria')
      const priorityMeta = getPriorityMeta(task.priority)
      const statusMeta = getStatusMeta(task.status)
      return [
        contact?.contact_name || contact?.push_name || '',
        careMeta.label,
        priorityMeta.label,
        statusMeta.label,
        contact?.ai_suggested_action || '',
        task.due_date ? format(new Date(task.due_date), 'dd/MM/yyyy') : '',
        contact?.phone || extractPhoneFromJid(contact?.jid) || '',
      ]
    })

    const dateStr = format(new Date(), 'yyyy-MM-dd')
    const filename = `tarefas_${activeCategory}_${dateStr}.csv`
    downloadCsv(filename, [headers, ...rows])
  }

  return (
    <div className="flex flex-col gap-6 h-full max-h-[calc(100vh-6rem)] overflow-hidden">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 shrink-0">
        <div>
          <h1 className="font-serif text-3xl font-bold text-primary">Tarefas</h1>
          <p className="text-muted-foreground mt-1">Gerencie as demandas da equipe.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={handleResync}
            disabled={syncing}
            className="rounded-full"
          >
            <RefreshCw className={cn('w-4 h-4 mr-2', syncing && 'animate-spin')} />
            {syncing ? 'Sincronizando...' : 'Re-sincronizar'}
          </Button>
          <Button
            onClick={() => openSecretary(null)}
            className="rounded-full bg-rose-600 hover:bg-rose-700 text-white"
          >
            <Heart className="w-4 h-4 mr-2" />
            Secretária de Cuidado
          </Button>
        </div>
      </div>

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

      <div className="flex gap-2 overflow-x-auto shrink-0 pb-1">
        {CARE_CATEGORY_TABS.map((tab) => {
          const isActive = activeCategory === tab.id
          const count =
            tab.id === 'todos'
              ? tasks.length
              : tasks.filter((t) => (t.care_category || 'sem_categoria') === tab.id).length
          return (
            <button
              key={tab.id}
              onClick={() => setActiveCategory(tab.id)}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium whitespace-nowrap transition-colors border',
                isActive
                  ? 'bg-primary text-primary-foreground border-primary shadow-sm'
                  : 'bg-background text-muted-foreground border-border hover:bg-muted',
              )}
            >
              <span>{tab.emoji}</span>
              <span>{tab.label}</span>
              <span
                className={cn(
                  'text-[10px] px-1.5 py-0.5 rounded-full',
                  isActive ? 'bg-primary-foreground/20' : 'bg-muted',
                )}
              >
                {count}
              </span>
            </button>
          )
        })}
      </div>

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
        <Button
          variant="outline"
          size="sm"
          onClick={handleExportCsv}
          disabled={filteredTasks.length === 0}
          className="ml-auto h-9"
        >
          <Download className="w-4 h-4 mr-2" />
          Exportar CSV
        </Button>
      </div>

      <div className="flex-1 overflow-x-auto overflow-y-hidden pb-4">
        <div className="flex gap-6 min-w-max h-full items-stretch">
          {TASK_STATUSES.map((status) => {
            const statusTasks = filteredTasks.filter((t) => t.status === status.id)
            const colSearch = columnSearches[status.id] || ''
            const columnTasks = colSearch
              ? statusTasks.filter((t) => {
                  const contact = t.expand?.crm_contact_id
                  const name = (
                    contact?.contact_name ||
                    contact?.push_name ||
                    t.title ||
                    ''
                  ).toLowerCase()
                  const phone = (contact?.phone || contact?.jid?.split('@')[0] || '').toLowerCase()
                  const q = colSearch.toLowerCase()
                  return name.includes(q) || phone.includes(q)
                })
              : statusTasks
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
                <div className="p-3 border-b bg-white/50 backdrop-blur-sm rounded-t-xl shrink-0 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 font-semibold text-sm">
                      <span className={cn('w-2 h-2 rounded-full', status.dot)} />
                      <span>
                        {columnTasks.length}{' '}
                        {columnTasks.length === 1 ? status.label.toLowerCase() : status.pluralLabel}
                      </span>
                    </div>
                  </div>
                  <div className="relative">
                    <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground pointer-events-none" />
                    <Input
                      placeholder="Buscar paciente..."
                      value={colSearch}
                      onChange={(e) =>
                        setColumnSearches((prev) => ({
                          ...prev,
                          [status.id]: e.target.value,
                        }))
                      }
                      onClick={(e) => e.stopPropagation()}
                      className="h-7 pl-7 pr-7 text-xs bg-background"
                    />
                    {colSearch && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          setColumnSearches((prev) => ({ ...prev, [status.id]: '' }))
                        }}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                </div>

                <div className="p-3 flex flex-col gap-3 overflow-y-auto flex-1">
                  {columnTasks.length === 0 ? (
                    <div className="h-28 border-2 border-dashed rounded-xl flex items-center justify-center text-muted-foreground text-sm flex-col gap-2 opacity-50">
                      <status.icon className="w-5 h-5" />
                      {colSearch ? 'Nenhum paciente encontrado' : 'Nenhuma tarefa'}
                    </div>
                  ) : (
                    columnTasks.map((task) => (
                      <CareTaskCard
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
                        onOpenSecretary={() => openSecretary(task)}
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
      <CareSecretarySheet
        open={secretaryOpen}
        onOpenChange={setSecretaryOpen}
        contextTask={secretaryContext}
      />
    </div>
  )
}
