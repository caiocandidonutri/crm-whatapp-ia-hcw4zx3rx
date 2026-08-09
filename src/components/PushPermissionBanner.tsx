import { Bell, X, BellRing } from 'lucide-react'
import { Button } from '@/components/ui/button'

type Props = {
  show: boolean
  onAccept: () => void
  onDismiss: () => void
}

export function PushPermissionBanner({ show, onAccept, onDismiss }: Props) {
  if (!show) return null
  return (
    <div className="fixed bottom-4 right-4 z-50 max-w-sm animate-fade-in-up">
      <div className="bg-white border border-border rounded-2xl shadow-lg p-4 flex flex-col gap-3">
        <div className="flex items-start gap-3">
          <div className="bg-primary/10 p-2 rounded-lg shrink-0">
            <BellRing className="w-5 h-5 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-sm">Ativar notificações?</h3>
            <p className="text-xs text-muted-foreground mt-1">
              Receba alertas de novas mensagens, tarefas e cuidados mesmo com outras abas abertas.
            </p>
            <p className="text-[10px] text-muted-foreground/60 mt-1">
              Notificações com o app fechado requerem um provedor de push externo (em breve).
            </p>
          </div>
          <button
            onClick={onDismiss}
            className="text-muted-foreground hover:text-foreground shrink-0"
            aria-label="Fechar"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="flex gap-2">
          <Button size="sm" className="flex-1 rounded-xl" onClick={onAccept}>
            <Bell className="w-3.5 h-3.5 mr-1.5" />
            Permitir
          </Button>
          <Button size="sm" variant="ghost" className="rounded-xl" onClick={onDismiss}>
            Agora não
          </Button>
        </div>
      </div>
    </div>
  )
}
