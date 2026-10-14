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

export interface DetectedBudgetResult {
  value: number
  matched: string
}

/**
 * Detecta valores monetários BRL (R$ 1.234,56, "1200 reais", "1,2k") nas mensagens recentes.
 * Sempre retorna null ou { value: number, matched: string }.
 */
export function extractBrlBudgetFromText(text?: string | null): DetectedBudgetResult | null {
  if (!text) return null
  const clean = text.replace(/\s+/g, ' ')

  // 1. Padrão R$ 1.250,50 ou R$ 1250,50 ou R$ 1250 ou R$1.200
  const r1 = /r\$\s*([0-9]{1,3}(?:\.[0-9]{3})*(?:,[0-9]{2})?|[0-9]+(?:,[0-9]{2})?)/i.exec(clean)
  if (r1 && r1[1]) {
    const rawNum = r1[1].replace(/\./g, '').replace(',', '.')
    const val1 = parseFloat(rawNum)
    if (!isNaN(val1) && val1 >= 50 && val1 <= 50000) {
      return { value: val1, matched: r1[0].trim() }
    }
  }

  // 2. Padrão "1,2k" ou "1.5k" ou "2k"
  const r2 = /\b([0-9]+(?:[.,][0-9]+)?)\s*k\b/i.exec(clean)
  if (r2 && r2[1]) {
    const kNum = parseFloat(r2[1].replace(',', '.'))
    if (!isNaN(kNum)) {
      const val2 = Math.round(kNum * 1000)
      if (val2 >= 50 && val2 <= 50000) {
        return { value: val2, matched: r2[0].trim() }
      }
    }
  }

  // 3. Padrão "1200 reais" ou "1.500 reais" ou "350 conto"
  const r3 = /\b([0-9]{1,3}(?:\.[0-9]{3})*|[0-9]+)(?:,[0-9]{2})?\s*(?:reais|real|conto)\b/i.exec(
    clean,
  )
  if (r3 && r3[1]) {
    const val3 = parseFloat(r3[1].replace(/\./g, ''))
    if (!isNaN(val3) && val3 >= 50 && val3 <= 50000) {
      return { value: val3, matched: r3[0].trim() }
    }
  }

  return null
}

export const requestAiContactSuggestion = async (contactId: string) => {
  return pb.send<{
    contact_id: string
    suggested_action: string
    priority: number
    detected_budget?: { value: number; label: string } | null
  }>('/backend/v1/crm/ai-suggestion', {
    method: 'POST',
    body: JSON.stringify({ contact_id: contactId }),
    headers: { 'Content-Type': 'application/json' },
  })
}
