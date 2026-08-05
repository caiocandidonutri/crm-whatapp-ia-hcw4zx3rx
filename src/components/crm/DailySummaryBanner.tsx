import { Sparkles, RefreshCw, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface DailySummaryBannerProps {
  summary: string | null
  loading: boolean
  onRefresh: () => void
  refreshing: boolean
}

export function DailySummaryBanner({
  summary,
  loading,
  onRefresh,
  refreshing,
}: DailySummaryBannerProps) {
  return (
    <div className="flex items-center gap-3 bg-gradient-to-r from-primary/5 to-primary/10 border border-primary/20 rounded-2xl px-4 py-3">
      <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
        <Sparkles className="w-4 h-4 text-primary" />
      </div>
      <div className="flex-1 min-w-0">
        {loading ? (
          <div className="flex items-center gap-2">
            <Loader2 className="w-3.5 h-3.5 animate-spin text-primary" />
            <span className="text-sm text-muted-foreground">Gerando resumo do dia...</span>
          </div>
        ) : (
          <p className="text-sm font-medium text-foreground leading-snug">
            {summary || 'Nenhum resumo disponível.'}
          </p>
        )}
      </div>
      <Button
        variant="ghost"
        size="sm"
        onClick={onRefresh}
        disabled={refreshing}
        className="shrink-0 rounded-full h-8 px-3 text-xs"
      >
        {refreshing ? (
          <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
        ) : (
          <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
        )}
        {refreshing ? 'Atualizando...' : 'Atualizar IA'}
      </Button>
    </div>
  )
}
