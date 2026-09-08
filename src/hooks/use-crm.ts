import { useState, useEffect, useRef } from 'react'
import { useRealtime } from './use-realtime'
import pb from '@/lib/pocketbase/client'
import { CrmContact } from '@/types/models'
import { getCrmContacts, getCrmContactsPage } from '@/services/crm_service'
import { toast } from 'sonner'

export { formatPhoneBR } from '@/lib/phone'

export function useCrmContatos(instanceName?: string) {
  const [contacts, setContacts] = useState<CrmContact[]>([])
  const [loading, setLoading] = useState(true)
  const [recentlyChangedIds, setRecentlyChangedIds] = useState<Set<string>>(new Set())

  const markRecentlyChanged = (ids: string[]) => {
    setRecentlyChangedIds((prev) => {
      const next = new Set(prev)
      ids.forEach((id) => next.add(id))
      return next
    })
    ids.forEach((id) => {
      setTimeout(() => {
        setRecentlyChangedIds((prev) => {
          const next = new Set(prev)
          next.delete(id)
          return next
        })
      }, 30000)
    })
  }

  const loadData = async () => {
    if (!instanceName) return
    try {
      setLoading(true)
      const data = await getCrmContacts(instanceName)
      setContacts(data)
    } catch (err) {
      toast.error('Erro ao carregar contatos do CRM')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [instanceName])

  useRealtime(
    'crm_contacts',
    (e) => {
      if (e.record.instance_name !== instanceName) return

      if (e.action === 'create') {
        const rec = e.record as CrmContact
        markRecentlyChanged([rec.id])
        setContacts((prev) => {
          if (prev.some((c) => c.id === rec.id)) return prev
          return [rec, ...prev]
        })
        // O payload do realtime não traz `expand`. Se o contato tem
        // responsável/empresa, buscamos o registro expandido pra empresa e
        // avatar aparecerem no card imediatamente (sem esperar um reload).
        if (rec.assigned_to || rec.company_id) {
          pb.collection('crm_contacts')
            .getOne<CrmContact>(rec.id, { expand: 'assigned_to,company_id' })
            .then((full) => setContacts((prev) => prev.map((c) => (c.id === full.id ? full : c))))
            .catch(() => {})
        }
      } else if (e.action === 'update') {
        markRecentlyChanged([e.record.id])
        // Preserva o expand anterior (responsável/empresa) que o realtime não
        // envia — senão o avatar/empresa some do card ao arrastar/atualizar.
        setContacts((prev) =>
          prev.map((c) => {
            if (c.id !== e.record.id) return c
            const next = e.record as CrmContact
            return { ...next, expand: next.expand || c.expand }
          }),
        )
      } else if (e.action === 'delete') {
        setContacts((prev) => prev.filter((c) => c.id !== e.record.id))
      }
    },
    !!instanceName,
  )

  return { contacts, loading, reload: loadData, recentlyChangedIds, markRecentlyChanged }
}

export function useCrmContatosPaginated(
  instanceName?: string,
  search?: string,
  perPage: number = 50,
) {
  const [contacts, setContacts] = useState<CrmContact[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const [recentlyChangedIds, setRecentlyChangedIds] = useState<Set<string>>(new Set())
  const pageRef = useRef(1)

  const markRecentlyChanged = (ids: string[]) => {
    setRecentlyChangedIds((prev) => {
      const next = new Set(prev)
      ids.forEach((id) => next.add(id))
      return next
    })
    ids.forEach((id) => {
      setTimeout(() => {
        setRecentlyChangedIds((prev) => {
          const next = new Set(prev)
          next.delete(id)
          return next
        })
      }, 30000)
    })
  }

  const loadData = async () => {
    if (!instanceName) return
    try {
      setLoading(true)
      const result = await getCrmContactsPage(instanceName, 1, perPage, search)
      setContacts(result.items)
      pageRef.current = 1
      setHasMore(1 < result.totalPages)
    } catch {
      toast.error('Erro ao carregar contatos do CRM')
    } finally {
      setLoading(false)
    }
  }

  const loadMore = async () => {
    if (!instanceName || loadingMore || !hasMore) return
    setLoadingMore(true)
    try {
      const nextPage = pageRef.current + 1
      const result = await getCrmContactsPage(instanceName, nextPage, perPage, search)
      setContacts((prev) => [...prev, ...result.items])
      pageRef.current = nextPage
      setHasMore(nextPage < result.totalPages)
    } catch {
      // ignore
    } finally {
      setLoadingMore(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [instanceName, search, perPage])

  useRealtime(
    'crm_contacts',
    (e) => {
      if (e.record.instance_name !== instanceName) return
      if (e.action === 'create') {
        const rec = e.record as CrmContact
        markRecentlyChanged([rec.id])
        setContacts((prev) => (prev.some((c) => c.id === rec.id) ? prev : [rec, ...prev]))
      } else if (e.action === 'update') {
        markRecentlyChanged([e.record.id])
        setContacts((prev) =>
          prev.map((c) => {
            if (c.id !== e.record.id) return c
            const next = e.record as CrmContact
            return { ...next, expand: next.expand || c.expand }
          }),
        )
      } else if (e.action === 'delete') {
        setContacts((prev) => prev.filter((c) => c.id !== e.record.id))
      }
    },
    !!instanceName,
  )

  return {
    contacts,
    loading,
    loadingMore,
    hasMore,
    loadMore,
    reload: loadData,
    recentlyChangedIds,
    markRecentlyChanged,
  }
}
