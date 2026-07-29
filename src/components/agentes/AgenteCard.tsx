import { AiAgent } from '@/types/models'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Pencil, Trash2, Sparkles } from 'lucide-react'

interface Props {
  agent: AiAgent
  onEdit: (agent: AiAgent) => void
  onDelete: (id: string) => void
}

export function AgenteCard({ agent, onEdit, onDelete }: Props) {
  return (
    <Card
      className="group relative overflow-hidden transition-all hover:shadow-md border-border/50 hover:border-border cursor-pointer"
      onClick={() => onEdit(agent)}
    >
      <div className="absolute top-3 right-3 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity z-10 bg-background/80 backdrop-blur-sm rounded-md p-1">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-muted-foreground hover:text-primary"
          onClick={(e) => {
            e.stopPropagation()
            onEdit(agent)
          }}
        >
          <Pencil className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
          onClick={(e) => {
            e.stopPropagation()
            onDelete(agent.id)
          }}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>

      <CardHeader className="pb-3">
        <div className="flex items-center gap-2 mb-2">
          <Badge variant="secondary" className="bg-emerald-100 text-emerald-800 border-emerald-200">
            <Sparkles className="w-3 h-3 mr-1" />
            Skip Cloud AI
          </Badge>
        </div>
        <CardTitle className="text-lg font-semibold tracking-tight">{agent.name}</CardTitle>
      </CardHeader>

      <CardContent>
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground line-clamp-4 leading-relaxed">
            {agent.system_prompt}
          </p>
        </div>
      </CardContent>
    </Card>
  )
}
