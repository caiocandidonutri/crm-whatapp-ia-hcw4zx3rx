import { useState, useEffect, useCallback } from 'react'
import { useRealtime } from './use-realtime'
import { CrmStage, listCrmStages, seedDefaultStages } from '@/services/crm_stages_service'

// Guarda por sessão pra não re-seedar a mesma conta várias vezes quando
// múltiplos componentes montam o hook ao mesmo tempo. O índice único
// (account_id, key) no banco é a garantia final contra duplicatas.
const seedingAccounts = new Set<string>()

const byPosition = (a: CrmStage, b: CrmStage) => (a.position ?? 0) - (b.position ?? 0)

/**
 * Carrega as etapas do pipeline da conta, com realtime. Quando `seed` é
 * true e a conta ainda não tem nenhuma etapa, cria as 4 padrão (lazy seed)
 * — cobre contas existentes (antes da feature) e novas, sem depender de
 * hook server-side.
 */
export function useCrmStages(accountId?: string, opts?: { seed?: boolean }) {
  const seed = opts?.seed === true
  const [stages, setStages] = useState<CrmStage[]>([])
  const [loading, setLoading] = useState(true)

  const loadData = useCallback(async () => {
    if (!accountId) {
      setStages([])
      setLoading(false)
      return
    }
    try {
      setLoading(true)
      let data = await listCrmStages(accountId)
      if (data.length === 0 && seed && !seedingAccounts.has(accountId)) {
        seedingAccounts.add(accountId)
        data = await seedDefaultStages(accountId)
      }
      setStages(data.sort(byPosition))
    } catch {
      /* silencioso — realtime/reload recupera */
    } finally {
      setLoading(false)
    }
  }, [accountId, seed])

  useEffect(() => {
    loadData()
  }, [loadData])

  useRealtime<CrmStage>(
    'crm_stages',
    (e) => {
      if (!accountId || e.record.account_id !== accountId) return
      if (e.action === 'create') {
        setStages((prev) =>
          prev.some((s) => s.id === e.record.id) ? prev : [...prev, e.record].sort(byPosition),
        )
      } else if (e.action === 'update') {
        setStages((prev) => prev.map((s) => (s.id === e.record.id ? e.record : s)).sort(byPosition))
      } else if (e.action === 'delete') {
        setStages((prev) => prev.filter((s) => s.id !== e.record.id))
      }
    },
    !!accountId,
  )

  return { stages, loading, reload: loadData }
}
