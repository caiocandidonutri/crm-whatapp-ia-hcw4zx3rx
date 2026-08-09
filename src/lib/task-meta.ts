import { Clock, CheckCircle2, XCircle, Loader2 } from 'lucide-react'

export const TASK_STATUSES = [
  {
    id: 'pendente',
    label: 'Pendente',
    color: 'bg-slate-100 text-slate-700 border-slate-200',
    icon: Clock,
    dot: 'bg-slate-500',
  },
  {
    id: 'em_andamento',
    label: 'Em andamento',
    color: 'bg-amber-100 text-amber-700 border-amber-200',
    icon: Loader2,
    dot: 'bg-amber-500',
  },
  {
    id: 'concluida',
    label: 'Concluída',
    color: 'bg-emerald-100 text-emerald-700 border-emerald-200',
    icon: CheckCircle2,
    dot: 'bg-emerald-500',
  },
  {
    id: 'cancelada',
    label: 'Cancelada',
    color: 'bg-rose-100 text-rose-700 border-rose-200',
    icon: XCircle,
    dot: 'bg-rose-500',
  },
] as const

export const TASK_PRIORITIES = [
  { id: 'baixa', label: 'Baixa', color: 'bg-blue-100 text-blue-700 border-blue-200' },
  { id: 'media', label: 'Média', color: 'bg-yellow-100 text-yellow-700 border-yellow-200' },
  { id: 'alta', label: 'Alta', color: 'bg-orange-100 text-orange-700 border-orange-200' },
  { id: 'urgente', label: 'Urgente', color: 'bg-red-100 text-red-700 border-red-200' },
] as const

export function getStatusMeta(status: string) {
  return TASK_STATUSES.find((s) => s.id === status) || TASK_STATUSES[0]
}

export function getPriorityMeta(priority: string) {
  return TASK_PRIORITIES.find((p) => p.id === priority) || TASK_PRIORITIES[0]
}

export const CARE_CATEGORIES = [
  {
    id: 'sem_categoria',
    label: 'Sem categoria',
    color: 'bg-slate-100 text-slate-600 border-slate-200',
    dot: 'bg-slate-400',
    emoji: '📋',
  },
  {
    id: 'nao_respondeu',
    label: 'Não respondeu',
    color: 'bg-rose-100 text-rose-700 border-rose-200',
    dot: 'bg-rose-500',
    emoji: '⏰',
  },
  {
    id: 'precisa_retorno',
    label: 'Precisa retorno',
    color: 'bg-amber-100 text-amber-700 border-amber-200',
    dot: 'bg-amber-500',
    emoji: '🔄',
  },
  {
    id: 'precisa_consulta',
    label: 'Precisa consulta',
    color: 'bg-blue-100 text-blue-700 border-blue-200',
    dot: 'bg-blue-500',
    emoji: '📅',
  },
  {
    id: 'precisa_atencao',
    label: 'Precisa atenção',
    color: 'bg-violet-100 text-violet-700 border-violet-200',
    dot: 'bg-violet-500',
    emoji: '⚡',
  },
  {
    id: 'followup_10_15',
    label: 'Follow-up 10-15 dias',
    color: 'bg-teal-100 text-teal-700 border-teal-200',
    dot: 'bg-teal-500',
    emoji: '⏳',
  },
  {
    id: 'alta_demanda',
    label: 'Alta demanda',
    color: 'bg-orange-100 text-orange-700 border-orange-200',
    dot: 'bg-orange-500',
    emoji: '🚨',
  },
] as const

export const CARE_CATEGORY_TABS = [
  { id: 'todos', label: 'Todos', emoji: '📋' },
  { id: 'nao_respondeu', label: 'Não responderam', emoji: '⏰' },
  { id: 'precisa_retorno', label: 'Precisa retorno', emoji: '🔄' },
  { id: 'precisa_consulta', label: 'Precisa consulta', emoji: '📅' },
  { id: 'precisa_atencao', label: 'Precisa atenção', emoji: '⚡' },
  { id: 'followup_10_15', label: 'Follow-up 10-15 dias', emoji: '⏳' },
  { id: 'alta_demanda', label: 'Alta demanda', emoji: '🚨' },
] as const

export function getCareCategoryMeta(category: string) {
  return CARE_CATEGORIES.find((c) => c.id === category) || CARE_CATEGORIES[0]
}
