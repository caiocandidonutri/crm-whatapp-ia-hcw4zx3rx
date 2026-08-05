import { useState } from 'react'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import {
  Users,
  UserCheck,
  TrendingUp,
  Heart,
  ChevronLeft,
  ChevronRight,
  Calendar,
} from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { CrmContact } from '@/types/models'
import { CrmStage } from '@/services/crm_stages_service'
import { stageStyle } from '@/lib/stage-colors'

interface CrmMonthlyReportProps {
  contacts: CrmContact[]
  stages: CrmStage[]
}

export function CrmMonthlyReport({ contacts, stages }: CrmMonthlyReportProps) {
  const [selectedDate, setSelectedDate] = useState(new Date())

  const now = new Date()
  const isCurrentMonth =
    selectedDate.getMonth() === now.getMonth() && selectedDate.getFullYear() === now.getFullYear()

  const monthStart = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1)
  const monthEnd = new Date(selectedDate.getFullYear(), selectedDate.getMonth() + 1, 1)

  const monthContacts = contacts.filter((c) => {
    const created = new Date(c.created)
    return created >= monthStart && created < monthEnd
  })

  const leadsInMonth = monthContacts.filter((c) => {
    if (c.is_patient && c.converted_at) {
      return new Date(c.converted_at) >= monthStart
    }
    return true
  })

  const alreadyPatients = contacts.filter((c) => {
    if (!c.is_patient || !c.converted_at) return false
    return new Date(c.converted_at) < monthStart
  })

  const conversionsInMonth = contacts.filter((c) => {
    if (!c.converted_at) return false
    const converted = new Date(c.converted_at)
    return converted >= monthStart && converted < monthEnd
  })

  const closingRate =
    leadsInMonth.length > 0
      ? Math.round((conversionsInMonth.length / leadsInMonth.length) * 100)
      : 0

  const stageDistribution = stages.map((s) => ({
    stage: s,
    count: monthContacts.filter((c) => c.stage === s.key).length,
  }))

  const maxStageCount = Math.max(...stageDistribution.map((s) => s.count), 1)

  const cards = [
    {
      label: 'Leads que chegaram no mês',
      value: leadsInMonth.length,
      icon: Users,
      color: 'text-blue-600',
      bg: 'bg-blue-50',
    },
    {
      label: 'Já eram pacientes',
      value: alreadyPatients.length,
      icon: Heart,
      color: 'text-emerald-600',
      bg: 'bg-emerald-50',
    },
    {
      label: 'Pacientes no mês (conversões)',
      value: conversionsInMonth.length,
      icon: UserCheck,
      color: 'text-violet-600',
      bg: 'bg-violet-50',
    },
    {
      label: 'Taxa de fechamento',
      value: `${closingRate}%`,
      icon: TrendingUp,
      color: 'text-amber-600',
      bg: 'bg-amber-50',
      subtext: `${conversionsInMonth.length} de ${leadsInMonth.length} leads fecharam`,
    },
  ]

  return (
    <div className="flex flex-col gap-6 animate-fade-in">
      <div className="flex items-center gap-3 flex-wrap">
        <Button
          variant="outline"
          size="icon"
          className="rounded-full h-9 w-9"
          onClick={() =>
            setSelectedDate(new Date(selectedDate.getFullYear(), selectedDate.getMonth() - 1, 1))
          }
        >
          <ChevronLeft className="w-4 h-4" />
        </Button>
        <div className="flex items-center gap-2">
          <Calendar className="w-4 h-4 text-muted-foreground" />
          <span className="text-lg font-serif font-bold text-primary capitalize">
            {format(selectedDate, "MMMM 'de' yyyy", { locale: ptBR })}
          </span>
        </div>
        <Button
          variant="outline"
          size="icon"
          className="rounded-full h-9 w-9"
          onClick={() =>
            setSelectedDate(new Date(selectedDate.getFullYear(), selectedDate.getMonth() + 1, 1))
          }
          disabled={isCurrentMonth}
        >
          <ChevronRight className="w-4 h-4" />
        </Button>
        {isCurrentMonth && (
          <Badge variant="secondary" className="ml-1">
            Mês atual
          </Badge>
        )}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {cards.map((card) => (
          <Card
            key={card.label}
            className="border-border/40 shadow-sm bg-white/50 backdrop-blur-sm rounded-xl"
          >
            <CardContent className="p-4 flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <div
                  className={cn(
                    'w-8 h-8 rounded-lg flex items-center justify-center shrink-0',
                    card.bg,
                  )}
                >
                  <card.icon className={cn('w-4 h-4', card.color)} />
                </div>
                <span className="text-xs font-medium text-muted-foreground leading-tight">
                  {card.label}
                </span>
              </div>
              <span className="text-3xl font-serif font-bold text-primary leading-none">
                {card.value}
              </span>
              {card.subtext && (
                <span className="text-[11px] text-muted-foreground/80">{card.subtext}</span>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="border-border/40 shadow-sm bg-white/50 backdrop-blur-sm rounded-2xl">
        <CardContent className="p-6">
          <h3 className="font-serif text-lg font-bold text-primary mb-4">Distribuição por etapa</h3>
          <div className="flex flex-col gap-3">
            {stageDistribution.map(({ stage, count }) => (
              <div key={stage.id} className="flex items-center gap-3">
                <div className="flex items-center gap-2 w-40 shrink-0">
                  <span
                    className={cn('w-2.5 h-2.5 rounded-full shrink-0', stageStyle(stage.color).dot)}
                  />
                  <span className="text-sm font-medium text-foreground truncate">
                    {stage.label}
                  </span>
                </div>
                <div className="flex-1 h-7 bg-muted/50 rounded-lg overflow-hidden">
                  <div
                    className={cn(
                      'h-full rounded-lg transition-all duration-500',
                      stageStyle(stage.color).dot,
                    )}
                    style={{ width: `${(count / maxStageCount) * 100}%` }}
                  />
                </div>
                <span className="text-sm font-bold text-foreground w-8 text-right">{count}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
