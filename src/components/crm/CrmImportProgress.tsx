import { Loader2, Download } from 'lucide-react'
import { cn } from '@/lib/utils'
import { WhatsappInstance } from '@/types/models'

interface CrmImportProgressProps {
  instance: WhatsappInstance | null | undefined
}

export function CrmImportProgress({ instance }: CrmImportProgressProps) {
  if (!instance || !instance.is_importing_history) return null

  const processed = instance.import_messages_count || 0
  const total = instance.import_total_count || 0
  const percentage = total > 0 ? Math.min(Math.round((processed / total) * 100), 100) : 0

  return (
    <div
      className={cn(
        'shrink-0 rounded-xl border border-blue-200 bg-blue-50/80 backdrop-blur-sm',
        'shadow-sm overflow-hidden animate-fade-in',
      )}
      role="status"
      aria-live="polite"
    >
      <div className="flex items-center gap-3 px-4 py-3">
        <div className="relative shrink-0">
          <div className="w-9 h-9 rounded-full bg-blue-100 flex items-center justify-center">
            <Download className="w-4 h-4 text-blue-700" />
          </div>
          <Loader2 className="absolute -top-0.5 -right-0.5 w-4 h-4 animate-spin text-blue-600 bg-white rounded-full p-0.5 border border-blue-200" />
        </div>

        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-blue-900">
            Sincronizando conversas com o CRM
            {instance.instance_name && (
              <span className="text-blue-700/70 font-normal ml-1">· {instance.instance_name}</span>
            )}
          </p>
          <p className="text-xs text-blue-700/80 mt-0.5">
            {total > 0 ? (
              <>
                <span className="font-semibold">{processed}</span> de{' '}
                <span className="font-semibold">{total}</span> conversas processadas ({percentage}%)
              </>
            ) : (
              'Iniciando sincronização...'
            )}
          </p>
        </div>
      </div>

      <div className="h-1.5 bg-blue-100 overflow-hidden">
        <div
          className="h-full bg-blue-500 transition-all duration-500 ease-out"
          style={{ width: `${total > 0 ? percentage : 100}%` }}
        />
      </div>
    </div>
  )
}
