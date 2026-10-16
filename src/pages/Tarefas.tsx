import { useState, useMemo, useEffect, useRef } from 'react'
import { useTasks } from '@/hooks/use-tasks'
import {
  TASK_STATUSES,
  TASK_PRIORITIES,
  CARE_CATEGORIES,
  CARE_CATEGORY_TABS,
  getCareCategoryMeta,
  getPriorityMeta,
  getStatusMeta,
} from '@/lib/task-meta'
import { downloadCsv, extractPhoneFromJid } from '@/lib/csv-export'
import { resolveDisplayName, formatPhoneBR } from '@/lib/phone'
import { formatBrazilianDate } from '@/lib/datetime'
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Search,
  Heart,
  Download,
  RefreshCw,
  X,
  ChevronDown,
  ListChecks,
  MoveRight,
  Tag,
} from 'lucide-react'
import { toast } from 'sonner'
import { resyncCareTasks } from '@/services/crm_care_service'
import { cn } from '@/lib/utils'
import { TaskViewDialog } from '@/components/TaskViewDialog'
import { CareTaskCard } from '@/components/CareTaskCard'
import { CareSecretarySheet } from '@/components/CareSecretarySheet'
import { updateTask, deleteTask } from '@/services/tasks'
import { useRealtime } from '@/hooks/use-realtime'
import { useAuth } from '@/hooks/use-auth'

export default function Tarefas() {
  const { user } = useAuth()
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
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [batchBusy, setBatchBusy] = useState(false)
  // Filtro de prioridade independente por coluna do Kanban.
  // Cada coluna (status) mantém seu próprio conjunto de prioridades
  // selecionadas; quando vazio, exibe todas.
  const [columnPriorities, setColumnPriorities] = useState<Record<string, Set<string>>>({})
  // No mobile: coluna ativa no seletor de abas
  const [mobileSelectedStatus, setMobileSelectedStatus] = useState<string>(TASK_STATUSES[0].id)

  // --- Realtime: atualiza o Kanban automaticamente quando o backend
  // altera care_status/stage/IA de um contato. O hook
  // crm_care_reclassify_tasks recalcula as tarefas no backend; aqui só
  // precisamos recarregar a lista de tasks quando um contato relevante
  // muda. Debounced pra não disparar um fetch por evento durante uma
  // rajada (ex.: cron diário reclassificando vários contatos).
  const reloadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const scheduleReload = () => {
    if (reloadTimerRef.current) clearTimeout(reloadTimerRef.current)
    reloadTimerRef.current = setTimeout(() => {
      loadTasks()
    }, 600)
  }
  useEffect(() => {
    return () => {
      if (reloadTimerRef.current) clearTimeout(reloadTimerRef.current)
    }
  }, [])

  useRealtime(
    'crm_contacts',
    () => {
      scheduleReload()
    },
    !!user,
  )

  const selectionMode = selectedIds.size > 0

  const toggleSelect = (id: string, checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (checked) next.add(id)
      else next.delete(id)
      return next
    })
  }

  const clearSelection = () => setSelectedIds(new Set())

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
    const list = tasks.filter((t) => {
      const matchSearch =
        t.title.toLowerCase().includes(search.toLowerCase()) ||
        (t.description || '').toLowerCase().includes(search.toLowerCase())
      const matchPriority = priorityFilter === 'todas' || t.priority === priorityFilter
      const matchMine = !filterMine || t.assigned_to === pb.authStore.record?.id
      const taskCareCategory = t.care_category || 'sem_categoria'
      const matchCategory = activeCategory === 'todos' || taskCareCategory === activeCategory
      return matchSearch && matchPriority && matchMine && matchCategory
    })

    // Ordenar no topo as tarefas URGENTES (priority === 'urgente' ou 'alta')
    const PRIORITY_ORDER: Record<string, number> = {
      urgente: 4,
      alta: 3,
      media: 2,
      baixa: 1,
    }

    return list.sort((a, b) => {
      const pA = PRIORITY_ORDER[a.priority] || 0
      const pB = PRIORITY_ORDER[b.priority] || 0
      if (pA !== pB) {
        return pB - pA // urgentes e altas primeiro
      }
      // Se mesma prioridade, ordenar por data de vencimento / criação
      const aDue = a.due_date ? new Date(a.due_date).getTime() : 0
      const bDue = b.due_date ? new Date(b.due_date).getTime() : 0
      if (aDue && bDue) return aDue - bDue
      if (aDue) return -1
      if (bDue) return 1
      const aCreated = a.created ? new Date(a.created).getTime() : 0
      const bCreated = b.created ? new Date(b.created).getTime() : 0
      return bCreated - aCreated
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
        resolveDisplayName(
          contact?.contact_name,
          contact?.jid || contact?.phone,
          contact?.push_name,
        ),
        careMeta.label,
        priorityMeta.label,
        statusMeta.label,
        contact?.ai_suggested_action || '',
        task.due_date ? formatBrazilianDate(task.due_date, true) : '',
        contact?.phone || extractPhoneFromJid(contact?.jid) || '',
      ]
    })

    const dateStr = format(new Date(), 'yyyy-MM-dd')
    const filename = `tarefas_${activeCategory}_${dateStr}.csv`
    downloadCsv(filename, [headers, ...rows])
  }

  // --- Ações em lote ---
  const selectedTasks = useMemo(
    () => tasks.filter((t) => selectedIds.has(t.id)),
    [tasks, selectedIds],
  )

  const handleBatchMove = async (statusId: string) => {
    if (selectedTasks.length === 0) return
    setBatchBusy(true)
    const updates: Partial<Task> = { status: statusId as any }
    if (statusId === 'concluida') {
      updates.completed_at = new Date().toISOString()
    }
    let ok = 0
    let fail = 0
    await Promise.all(
      selectedTasks.map(async (t) => {
        try {
          await updateTask(t.id, updates)
          ok++
        } catch {
          fail++
        }
      }),
    )
    setBatchBusy(false)
    if (fail === 0) {
      toast.success(`${ok} tarefa(s) movida(s) para ${getStatusMeta(statusId).label}.`)
    } else if (ok === 0) {
      toast.error('Não foi possível mover as tarefas.')
    } else {
      toast.warning(`${ok} movida(s), ${fail} falhou/falharam.`)
    }
    clearSelection()
  }

  const handleBatchCareStatus = async (careStatus: string) => {
    // care_status vive em crm_contacts, não em tasks. Para alterar o
    // status de cuidado dos selecionados, atualizamos o crm_contact_id
    // vinculado a cada tarefa selecionada. O hook
    // crm_care_reclassify_tasks então reclassifica as tarefas
    // automaticamente.
    if (selectedTasks.length === 0) return
    setBatchBusy(true)
    let ok = 0
    let fail = 0
    let skip = 0
    await Promise.all(
      selectedTasks.map(async (t) => {
        const contactId = t.crm_contact_id
        if (!contactId) {
          skip++
          return
        }
        try {
          await pb.collection('crm_contacts').update(contactId, { care_status: careStatus })
          ok++
        } catch {
          fail++
        }
      }),
    )
    setBatchBusy(false)
    if (fail === 0) {
      toast.success(
        `${ok} contato(s) marcado(s) como ${careStatus.replace(/_/g, ' ')}${skip > 0 ? ` (${skip} sem contato vinculado)` : ''}.`,
      )
    } else if (ok === 0) {
      toast.error('Não foi possível atualizar o status de cuidado.')
    } else {
      toast.warning(`${ok} atualizado(s), ${fail} falhou/falharam.`)
    }
    clearSelection()
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 shrink-0">
        <div>
          <div className="flex items-center gap-2.5 flex-wrap">
            <h1 className="font-serif text-3xl font-bold text-primary">Tarefas</h1>
            <Badge
              variant="outline"
              className="bg-primary/5 text-primary border-primary/20 text-xs font-semibold"
            >
              Demandas e follow-ups da equipe
            </Badge>
          </div>
          <p className="text-muted-foreground mt-1 text-sm">
            <strong>Tarefas — demandas e follow-ups da equipe.</strong> Acompanhamento por
            prioridade, prazos e cuidado do paciente.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            variant="outline"
            onClick={handleResync}
            disabled={syncing}
            className="rounded-full min-h-[44px] px-4"
          >
            <RefreshCw className={cn('w-4 h-4 mr-2', syncing && 'animate-spin')} />
            {syncing ? 'Sincronizando...' : 'Re-sincronizar'}
          </Button>
          <Button
            onClick={() => openSecretary(null)}
            className="rounded-full bg-rose-600 hover:bg-rose-700 text-white min-h-[44px] px-4"
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

      {/* Barra de ações em lote — só aparece quando há cards selecionados */}
      {selectionMode && (
        <div className="flex flex-wrap items-center gap-2 p-3 rounded-xl border border-primary/30 bg-primary/5 shrink-0 animate-in fade-in slide-in-from-top-2">
          <span className="flex items-center gap-1.5 text-sm font-semibold text-primary mr-2">
            <ListChecks className="w-4 h-4" />
            {selectedIds.size} selecionado{selectedIds.size === 1 ? '' : 's'}
          </span>

          <div className="h-5 w-px bg-border/60" />

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" disabled={batchBusy} className="h-8">
                <MoveRight className="w-3.5 h-3.5 mr-1.5" />
                Mover para
                <ChevronDown className="w-3 h-3 ml-1 opacity-50" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-48">
              <DropdownMenuLabel>Mover para</DropdownMenuLabel>
              {TASK_STATUSES.map((s) => (
                <DropdownMenuItem
                  key={s.id}
                  onClick={() => handleBatchMove(s.id)}
                  className="cursor-pointer"
                >
                  <span className={cn('w-2 h-2 rounded-full mr-2', s.dot)} />
                  {s.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" disabled={batchBusy} className="h-8">
                <Tag className="w-3.5 h-3.5 mr-1.5" />
                Marcar como
                <ChevronDown className="w-3 h-3 ml-1 opacity-50" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-56">
              <DropdownMenuLabel>Status de cuidado</DropdownMenuLabel>
              {CARE_CATEGORIES.filter((c) => c.id !== 'sem_categoria').map((c) => (
                <DropdownMenuItem
                  key={c.id}
                  onClick={() => handleBatchCareStatus(c.id)}
                  className="cursor-pointer"
                >
                  <span>{c.emoji}</span>
                  <span className="ml-1">{c.label}</span>
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => handleBatchCareStatus('em_dia')}
                className="cursor-pointer"
              >
                <span>✅</span>
                <span className="ml-1">Em dia</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <Button
            variant="ghost"
            size="sm"
            onClick={clearSelection}
            disabled={batchBusy}
            className="h-8 text-muted-foreground hover:text-foreground"
          >
            <X className="w-3.5 h-3.5 mr-1.5" />
            Limpar seleção
          </Button>

          {batchBusy && <span className="text-xs text-muted-foreground ml-1">Processando...</span>}
        </div>
      )}

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

      {/* Seletor de Coluna no Mobile (Tabs / Seletor de Coluna empilhada) */}
      <div className="md:hidden flex items-center gap-1.5 overflow-x-auto pb-2 scrollbar-none">
        {TASK_STATUSES.map((status) => {
          const count = filteredTasks.filter((t) => t.status === status.id).length
          const isSelected = mobileSelectedStatus === status.id
          return (
            <button
              key={status.id}
              onClick={() => setMobileSelectedStatus(status.id)}
              className={cn(
                'flex items-center gap-2 px-3.5 py-2 min-h-[44px] rounded-xl text-xs font-semibold whitespace-nowrap transition-colors border shrink-0',
                isSelected
                  ? 'bg-primary text-primary-foreground border-primary shadow-sm'
                  : 'bg-background text-muted-foreground border-border hover:bg-muted',
              )}
            >
              <span className={cn('w-2 h-2 rounded-full', status.dot)} />
              <span>{status.label}</span>
              <span
                className={cn(
                  'text-[11px] px-1.5 py-0.5 rounded-full font-bold',
                  isSelected ? 'bg-primary-foreground/20 text-white' : 'bg-muted text-foreground',
                )}
              >
                {count}
              </span>
            </button>
          )
        })}
      </div>

      {/* Kanban: Desktop (scroll horizontal) vs Mobile (visão empilhada por coluna selecionada) */}
      <div className="overflow-x-auto pb-4">
        <div className="flex md:flex-row flex-col gap-6 md:min-w-max items-stretch">
          {TASK_STATUSES.map((status) => {
            const statusTasks = filteredTasks.filter((t) => t.status === status.id)
            const colSearch = columnSearches[status.id] || ''
            const colPrioritySet = columnPriorities[status.id]
            const afterPriority =
              colPrioritySet && colPrioritySet.size > 0
                ? statusTasks.filter((t) => colPrioritySet.has(t.priority))
                : statusTasks
            const columnTasks = colSearch
              ? afterPriority.filter((t) => {
                  const contact = t.expand?.crm_contact_id
                  const name = resolveDisplayName(
                    contact?.contact_name,
                    contact?.jid || contact?.phone,
                    contact?.push_name || t.title,
                  ).toLowerCase()
                  const phone = (contact?.phone || contact?.jid?.split('@')[0] || '').toLowerCase()
                  const q = colSearch.toLowerCase()
                  return name.includes(q) || phone.includes(q)
                })
              : afterPriority
            const isDragOver = dragOverColumn === status.id

            const toggleColPriority = (pid: string) => {
              setColumnPriorities((prev) => {
                const next = { ...prev }
                const set = new Set(next[status.id] || [])
                if (set.has(pid)) set.delete(pid)
                else set.add(pid)
                next[status.id] = set
                return next
              })
            }

            const isMobileHidden = mobileSelectedStatus !== status.id

            return (
              <div
                key={status.id}
                className={cn(
                  'w-full md:w-80 shrink-0 flex flex-col rounded-xl bg-muted/30 border h-[calc(100vh-20rem)] min-h-[460px] transition-all duration-200',
                  isMobileHidden ? 'hidden md:flex' : 'flex',
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
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
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
                      className="h-9 pl-8 pr-8 text-xs bg-background"
                    />
                    {colSearch && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          setColumnSearches((prev) => ({ ...prev, [status.id]: '' }))
                        }}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground p-1"
                        aria-label="Limpar busca"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                  {/* Filtro por prioridade — independente por coluna.
                      Botões de toggle (multiseleção). Vazio = Todas. */}
                  <div className="flex flex-wrap items-center gap-1 pt-0.5">
                    <span className="text-[10px] text-muted-foreground/70 mr-0.5">Prioridade:</span>
                    <button
                      type="button"
                      onClick={() =>
                        setColumnPriorities((prev) => ({
                          ...prev,
                          [status.id]: new Set(),
                        }))
                      }
                      className={cn(
                        'px-2 py-1 min-h-[30px] rounded text-[11px] font-medium transition-colors border',
                        !colPrioritySet || colPrioritySet.size === 0
                          ? 'bg-primary text-primary-foreground border-primary'
                          : 'bg-background text-muted-foreground border-border hover:bg-muted',
                      )}
                    >
                      Todas
                    </button>
                    {TASK_PRIORITIES.slice()
                      .reverse()
                      .map((p) => {
                        const active = colPrioritySet?.has(p.id)
                        return (
                          <button
                            key={p.id}
                            type="button"
                            onClick={() => toggleColPriority(p.id)}
                            className={cn(
                              'px-2 py-1 min-h-[30px] rounded text-[11px] font-medium transition-colors border',
                              active
                                ? p.color
                                : 'bg-background text-muted-foreground border-border hover:bg-muted',
                            )}
                          >
                            {p.label}
                          </button>
                        )
                      })}
                  </div>
                </div>

                <div className="p-3 flex flex-col gap-3 overflow-y-auto flex-1">
                  {columnTasks.length === 0 ? (
                    <div className="h-32 border-2 border-dashed rounded-xl flex items-center justify-center text-muted-foreground text-sm flex-col gap-2 opacity-50">
                      <status.icon className="w-5 h-5" />
                      {colSearch || (colPrioritySet && colPrioritySet.size > 0)
                        ? 'Nenhum paciente encontrado'
                        : 'Nenhuma tarefa'}
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
                        selected={selectedIds.has(task.id)}
                        onToggleSelect={toggleSelect}
                        selectionMode={selectionMode}
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
