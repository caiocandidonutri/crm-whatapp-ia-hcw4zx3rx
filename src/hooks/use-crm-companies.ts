import { useState, useEffect, useCallback } from 'react'
import { useRealtime } from './use-realtime'
import { useAuth } from './use-auth'
import { CrmCompany } from '@/types/models'
import { listCrmCompanies } from '@/services/crm_companies_service'
import { toast } from 'sonner'

/**
 * Mantém em memória a lista de empresas do CRM do user logado, com
 * realtime para refletir create/update/delete sem refetch manual.
 * Lista vem ordenada por nome — o realtime preserva ordem ao patchear.
 */
export function useCrmEmpresas() {
  const { user } = useAuth()
  const [companies, setCompanies] = useState<CrmCompany[]>([])
  const [loading, setLoading] = useState(true)

  const reload = useCallback(async () => {
    if (!user) return
    try {
      setLoading(true)
      const data = await listCrmCompanies()
      setCompanies(data)
    } catch (err) {
      toast.error('Erro ao carregar empresas')
    } finally {
      setLoading(false)
    }
  }, [user])

  useEffect(() => {
    reload()
  }, [reload])

  useRealtime<CrmCompany>(
    'crm_companies',
    (e) => {
      if (!user || e.record.user_id !== user.id) return
      if (e.action === 'create') {
        setCompanies((prev) =>
          [e.record, ...prev].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')),
        )
      } else if (e.action === 'update') {
        setCompanies((prev) =>
          prev
            .map((c) => (c.id === e.record.id ? e.record : c))
            .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')),
        )
      } else if (e.action === 'delete') {
        setCompanies((prev) => prev.filter((c) => c.id !== e.record.id))
      }
    },
    !!user,
  )

  return { companies, loading, reload }
}
