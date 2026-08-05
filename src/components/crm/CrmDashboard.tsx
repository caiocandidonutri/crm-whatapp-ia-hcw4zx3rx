import { Users, UserCheck, Clock, AlertTriangle, TrendingUp, Heart } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { CrmContact } from '@/types/models'

interface CrmDashboardProps {
  contacts: CrmContact[]
  onStageClick: (stage: string) => void
  onRoleClick: (role: 'paciente' | 'nao_paciente') => void
}

export function CrmDashboard({ contacts, onStageClick, onRoleClick }: CrmDashboardProps) {
  const leads = contacts.filter((c) => c.stage === 'lead').length
  const emAtendimento = contacts.filter((c) => c.stage === 'em_atendimento').length
  const clientes = contacts.filter((c) => c.stage === 'cliente').length
  const naoRespondidos = contacts.filter((c) => c.stage === 'nao_respondido').length
  const pacientes = contacts.filter((c) => c.role === 'paciente').length
  const naoPacientes = contacts.filter((c) => c.role === 'nao_paciente').length
  const total = contacts.length
  const conversionRate = total > 0 ? Math.round((clientes / total) * 100) : 0

  const cards = [
    {
      label: 'Leads',
      value: leads,
      icon: Users,
      color: 'text-blue-600',
      bg: 'bg-blue-50',
      onClick: () => onStageClick('lead'),
    },
    {
      label: 'Em Atendimento',
      value: emAtendimento,
      icon: Clock,
      color: 'text-amber-600',
      bg: 'bg-amber-50',
      onClick: () => onStageClick('em_atendimento'),
    },
    {
      label: 'Clientes',
      value: clientes,
      icon: UserCheck,
      color: 'text-emerald-600',
      bg: 'bg-emerald-50',
      onClick: () => onStageClick('cliente'),
    },
    {
      label: 'Não Respondidos',
      value: naoRespondidos,
      icon: AlertTriangle,
      color: 'text-rose-600',
      bg: 'bg-rose-50',
      onClick: () => onStageClick('nao_respondido'),
      subtext: 'Precisa de atenção',
    },
    {
      label: 'Conversão',
      value: `${conversionRate}%`,
      icon: TrendingUp,
      color: 'text-violet-600',
      bg: 'bg-violet-50',
      onClick: () => {},
    },
    {
      label: 'Pacientes',
      value: pacientes,
      icon: Heart,
      color: 'text-emerald-600',
      bg: 'bg-emerald-50',
      onClick: () => onRoleClick('paciente'),
      subtext: `${naoPacientes} não pacientes`,
    },
  ]

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
      {cards.map((card) => (
        <Card
          key={card.label}
          className="border-border/40 shadow-sm bg-white/50 backdrop-blur-sm rounded-xl hover:shadow-md hover:border-primary/30 transition-all cursor-pointer"
          onClick={card.onClick}
        >
          <CardContent className="p-3 flex flex-col gap-1.5">
            <div className="flex items-center gap-2">
              <div
                className={cn(
                  'w-7 h-7 rounded-lg flex items-center justify-center shrink-0',
                  card.bg,
                )}
              >
                <card.icon className={cn('w-3.5 h-3.5', card.color)} />
              </div>
              <span className="text-xs font-medium text-muted-foreground truncate">
                {card.label}
              </span>
            </div>
            <span className="text-2xl font-serif font-bold text-primary leading-none">
              {card.value}
            </span>
            {card.subtext && (
              <span className="text-[10px] text-muted-foreground/80">{card.subtext}</span>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
