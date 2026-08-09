import { Filter } from 'lucide-react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

export interface CareFilterValues {
  period_days: string
  care_status: string
  min_priority: string
}

interface CareFiltersProps {
  values: CareFilterValues
  onChange: (values: CareFilterValues) => void
}

const PERIOD_OPTIONS = [
  { value: '0', label: 'Todo período' },
  { value: '7', label: '7 dias' },
  { value: '15', label: '15 dias' },
  { value: '30', label: '30 dias' },
]

const STATUS_OPTIONS = [
  { value: '', label: 'Todos status' },
  { value: 'em_dia', label: 'Em dia' },
  { value: 'precisa_retorno', label: 'Precisa retorno' },
  { value: 'desassistido', label: 'Desassistido' },
]

const PRIORITY_OPTIONS = [
  { value: '0', label: 'Todas prioridades' },
  { value: '4', label: 'Média (4+)' },
  { value: '6', label: 'Alta (6+)' },
  { value: '8', label: 'Urgente (8+)' },
]

export function CareFilters({ values, onChange }: CareFiltersProps) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <Filter className="w-3 h-3" />
        <span>Filtros</span>
      </div>
      <div className="grid grid-cols-3 gap-1.5">
        <Select
          value={values.period_days}
          onValueChange={(v) => onChange({ ...values, period_days: v })}
        >
          <SelectTrigger className="h-8 text-xs">
            <SelectValue placeholder="Período" />
          </SelectTrigger>
          <SelectContent>
            {PERIOD_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value} className="text-xs">
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={values.care_status}
          onValueChange={(v) => onChange({ ...values, care_status: v })}
        >
          <SelectTrigger className="h-8 text-xs">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            {STATUS_OPTIONS.map((opt) => (
              <SelectItem key={opt.value || 'all'} value={opt.value || 'all'} className="text-xs">
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={values.min_priority}
          onValueChange={(v) => onChange({ ...values, min_priority: v })}
        >
          <SelectTrigger className="h-8 text-xs">
            <SelectValue placeholder="Prioridade" />
          </SelectTrigger>
          <SelectContent>
            {PRIORITY_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value} className="text-xs">
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  )
}
