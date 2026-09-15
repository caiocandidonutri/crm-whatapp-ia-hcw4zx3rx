import pb from '@/lib/pocketbase/client'
import { CrmContact } from '@/types/models'

export type AddToCrmOptions = {
  /** Sobrescreve o contact_name da conversation. Útil quando o dialog
   *  de pré-validação coleta um nome editado pelo user. */
  contact_name?: string
  stage?: string
  company_id?: string
  role?: string
  email?: string
  assigned_to?: string
  category_ids?: string[]
}

export const adicionarContatoDoChat = async (
  instance_name: string,
  jid: string,
  options?: AddToCrmOptions,
) => {
  return pb.send<{ record: CrmContact; isAlreadyAdded: boolean }>('/backend/v1/crm/add-from-chat', {
    method: 'POST',
    body: JSON.stringify({ instance_name, jid, ...(options || {}) }),
    headers: { 'Content-Type': 'application/json' },
  })
}

export const getCrmContactByJid = async (instance_name: string, jid: string) => {
  try {
    return await pb
      .collection('crm_contacts')
      .getFirstListItem<CrmContact>(`instance_name = '${instance_name}' && jid = '${jid}'`, {
        requestKey: null,
      })
  } catch (e) {
    return null
  }
}

export const getCrmContacts = async (instance_name: string) => {
  return pb.collection('crm_contacts').getFullList<CrmContact>({
    filter: `instance_name = '${instance_name}'`,
    sort: '-created',
    expand: 'assigned_to,company_id',
    requestKey: null,
  })
}

export const getCrmContactsPage = async (
  instance_name: string,
  page: number = 1,
  perPage: number = 50,
  search?: string,
) => {
  let filter = `instance_name = '${instance_name}'`
  if (search && search.trim()) {
    const s = search.trim()
    filter += ` && (contact_name ~ '${s}' || push_name ~ '${s}' || phone ~ '${s}')`
  }
  return pb.collection('crm_contacts').getList<CrmContact>(page, perPage, {
    filter,
    sort: '-ai_priority,-created',
    expand: 'assigned_to,company_id',
    requestKey: null,
  })
}

export const updateCrmContactStage = async (id: string, stage: string) => {
  return pb.collection('crm_contacts').update<CrmContact>(id, { stage })
}

export const deleteCrmContact = async (id: string) => {
  return pb.collection('crm_contacts').delete(id)
}

export interface ImportConversasResult {
  total: number
  created: number
  classified: number
  skipped: number
  errors: number
  error?: string
  createdIds?: string[]
  updatedIds?: string[]
}

export const importarConversasCRM = async (): Promise<ImportConversasResult> => {
  try {
    return await pb.send<ImportConversasResult>('/backend/v1/crm/import-conversations', {
      method: 'POST',
      body: JSON.stringify({}),
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (err: any) {
    return {
      total: 0,
      created: 0,
      classified: 0,
      skipped: 0,
      errors: 1,
      error: err?.message || 'Falha ao importar conversas. Verifique sua conexão.',
    }
  }
}

export const refreshAiSuggestions = async () => {
  return pb.send<{ total: number; updated: number; errors: number }>(
    '/backend/v1/crm/refresh-suggestions',
    {
      method: 'POST',
      body: JSON.stringify({}),
      headers: { 'Content-Type': 'application/json' },
    },
  )
}

export const getDailySummary = async () => {
  return pb.send<{ summary: string }>('/backend/v1/crm/daily-summary', { method: 'GET' })
}
