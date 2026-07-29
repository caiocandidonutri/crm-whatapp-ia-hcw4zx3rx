import { useState, useEffect } from 'react'
import { useRealtime } from './use-realtime'
import pb from '@/lib/pocketbase/client'
import { CrmContact } from '@/types/models'
import { getCrmContacts } from '@/services/crm_service'
import { toast } from 'sonner'

export function formatPhoneBR(phone?: string) {
  if (!phone) return ''
  const digits = phone.replace(/\D/g, '')
  if (digits.startsWith('55') && digits.length >= 12) {
    const area = digits.slice(2, 4)
    const firstPart = digits.slice(4, digits.length - 4)
    const secondPart = digits.slice(digits.length - 4)
    return `+55 (${area}) ${firstPart}-${secondPart}`
  }
  return phone
}

export function useCrmContatos(instanceName?: string) {
  const [contacts, setContacts] = useState<CrmContact[]>([])
  const [loading, setLoading] = useState(true)

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

  useRealtime('crm_contacts', (e) => {
    if (e.record.instance_name !== instanceName) return

    if (e.action === 'create') {
      const rec = e.record as CrmContact
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
  })

  return { contacts, loading, reload: loadData }
}
