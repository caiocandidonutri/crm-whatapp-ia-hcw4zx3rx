import { X, CheckSquare } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'

export function TaskActionBar({
  selectedCount,
  onCancel,
  onCreateTask,
}: {
  selectedCount: number
  onCancel: () => void
  onCreateTask: () => void
}) {
  return (
    <div className="bg-white border-t border-border px-4 py-3 flex items-center justify-between z-20 shadow-[0_-4px_10px_rgba(0,0,0,0.05)] animate-fade-in-up">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" onClick={onCancel} className="rounded-full shrink-0">
          <X className="w-5 h-5 text-muted-foreground" />
        </Button>
        <span className="text-sm font-semibold text-foreground whitespace-nowrap">
          {selectedCount} {selectedCount === 1 ? 'mensagem selecionada' : 'mensagens selecionadas'}
        </span>
      </div>
      <Button
        onClick={onCreateTask}
        disabled={selectedCount === 0}
        className="rounded-full shadow-sm shrink-0 ml-4"
      >
        <CheckSquare className="w-4 h-4 mr-2" />
        Criar tarefa
      </Button>
    </div>
  )
}
