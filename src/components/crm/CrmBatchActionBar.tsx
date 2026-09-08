import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { CrmStage } from '@/services/crm_stages_service'
import { stageStyle } from '@/lib/stage-colors'
import {
  Layers,
  HeartPulse,
  Archive,
  ArchiveRestore,
  X,
  CheckCircle2,
  ChevronDown,
  Loader2,
} from 'lucide-react'

interface Props {
  selectedCount: number
  stages: CrmStage[]
  onClearSelection: () => void
  onAction: (
    actionType: 'stage' | 'care_status' | 'archive' | 'unarchive',
    targetValue?: string,
  ) => Promise<void>
  loading?: boolean
}

export function CrmBatchActionBar({
  selectedCount,
  stages,
  onClearSelection,
  onAction,
  loading = false,
}: Props) {
  const [actingAction, setActingAction] = useState<string | null>(null)

  if (selectedCount === 0) return null

  const handleExecute = async (
    actionType: 'stage' | 'care_status' | 'archive' | 'unarchive',
    targetValue?: string,
  ) => {
    setActingAction(actionType + (targetValue ? `_${targetValue}` : ''))
    try {
      await onAction(actionType, targetValue)
    } finally {
      setActingAction(null)
    }
  }

  return (
    <div className="fixed bottom-4 left-4 right-4 sm:left-auto sm:right-8 sm:bottom-6 z-50 flex items-center justify-center animate-in fade-in slide-in-from-bottom-4">
      <div className="w-full sm:w-auto bg-slate-900 text-slate-50 dark:bg-slate-950 dark:text-slate-100 rounded-2xl shadow-2xl border border-slate-700/60 p-2 sm:p-2.5 flex flex-wrap sm:flex-nowrap items-center justify-between gap-2 md:gap-3 backdrop-blur-lg">
        {/* Contador */}
        <div className="flex items-center gap-2 pl-2 sm:pl-3 pr-2">
          <div className="w-6 h-6 rounded-full bg-primary/20 text-primary-foreground flex items-center justify-center text-xs font-bold shrink-0">
            {selectedCount}
          </div>
          <span className="text-xs sm:text-sm font-semibold whitespace-nowrap">
            {selectedCount} {selectedCount === 1 ? 'selecionado' : 'selecionados'}
          </span>
        </div>

        <div className="h-5 w-px bg-slate-700 hidden sm:block" />

        {/* Ações em lote */}
        <div className="flex items-center gap-1.5 flex-1 sm:flex-initial justify-end">
          {/* Mudar Estágio */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                disabled={loading}
                className="h-11 sm:h-9 px-3 text-xs sm:text-sm text-slate-100 hover:text-white hover:bg-slate-800 rounded-xl min-h-[44px] sm:min-h-0"
              >
                {actingAction?.startsWith('stage') ? (
                  <Loader2 className="w-4 h-4 mr-1.5 animate-spin text-primary" />
                ) : (
                  <Layers className="w-4 h-4 mr-1.5 text-blue-400" />
                )}
                <span>Mudar Estágio</span>
                <ChevronDown className="w-3.5 h-3.5 ml-1 opacity-60" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="center" className="w-56 p-1.5 rounded-xl">
              <DropdownMenuLabel className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-2 py-1">
                Definir novo estágio
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              {stages.map((st) => (
                <DropdownMenuItem
                  key={st.id}
                  onClick={() => handleExecute('stage', st.key)}
                  className="text-xs sm:text-sm px-2.5 py-2 cursor-pointer rounded-lg min-h-[44px] sm:min-h-0"
                >
                  <span className={`w-2.5 h-2.5 rounded-full mr-2 ${stageStyle(st.color).dot}`} />
                  <span className="font-medium">{st.label}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Mudar Cuidado */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                disabled={loading}
                className="h-11 sm:h-9 px-3 text-xs sm:text-sm text-slate-100 hover:text-white hover:bg-slate-800 rounded-xl min-h-[44px] sm:min-h-0"
              >
                {actingAction?.startsWith('care_status') ? (
                  <Loader2 className="w-4 h-4 mr-1.5 animate-spin text-emerald-400" />
                ) : (
                  <HeartPulse className="w-4 h-4 mr-1.5 text-emerald-400" />
                )}
                <span>Status Cuidado</span>
                <ChevronDown className="w-3.5 h-3.5 ml-1 opacity-60" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="center" className="w-52 p-1.5 rounded-xl">
              <DropdownMenuLabel className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-2 py-1">
                Status de cuidado nutricional
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => handleExecute('care_status', 'em_dia')}
                className="text-xs sm:text-sm px-2.5 py-2 cursor-pointer rounded-lg min-h-[44px] sm:min-h-0"
              >
                <CheckCircle2 className="w-4 h-4 mr-2 text-emerald-600" />
                <span>Em dia (concluir pendências)</span>
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => handleExecute('care_status', 'precisa_retorno')}
                className="text-xs sm:text-sm px-2.5 py-2 cursor-pointer rounded-lg min-h-[44px] sm:min-h-0"
              >
                <span className="w-2.5 h-2.5 rounded-full bg-amber-500 mr-2" />
                <span>Precisa retorno</span>
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => handleExecute('care_status', 'sem_contato')}
                className="text-xs sm:text-sm px-2.5 py-2 cursor-pointer rounded-lg min-h-[44px] sm:min-h-0"
              >
                <span className="w-2.5 h-2.5 rounded-full bg-rose-500 mr-2" />
                <span>Sem contato</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Arquivar / Desarquivar */}
          <Button
            variant="ghost"
            size="sm"
            disabled={loading}
            onClick={() => handleExecute('archive')}
            title="Arquivar selecionados"
            className="h-11 sm:h-9 px-3 text-xs sm:text-sm text-slate-100 hover:text-white hover:bg-slate-800 rounded-xl min-h-[44px] sm:min-h-0"
          >
            {actingAction === 'archive' ? (
              <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
            ) : (
              <Archive className="w-4 h-4 mr-1.5 text-amber-400" />
            )}
            <span className="hidden sm:inline">Arquivar</span>
          </Button>

          <Button
            variant="ghost"
            size="sm"
            disabled={loading}
            onClick={() => handleExecute('unarchive')}
            title="Desarquivar selecionados"
            className="h-11 sm:h-9 px-3 text-xs sm:text-sm text-slate-100 hover:text-white hover:bg-slate-800 rounded-xl min-h-[44px] sm:min-h-0"
          >
            {actingAction === 'unarchive' ? (
              <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
            ) : (
              <ArchiveRestore className="w-4 h-4 mr-1.5 text-slate-300" />
            )}
            <span className="hidden sm:inline">Desarquivar</span>
          </Button>

          {/* Botão Limpar Seleção */}
          <Button
            variant="ghost"
            size="icon"
            disabled={loading}
            onClick={onClearSelection}
            title="Limpar seleção"
            className="h-11 w-11 sm:h-9 sm:w-9 text-slate-400 hover:text-white hover:bg-slate-800 rounded-xl min-h-[44px] min-w-[44px] sm:min-h-0 sm:min-w-0"
          >
            <X className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </div>
  )
}
