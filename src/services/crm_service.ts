import pb from '@/lib/pocketbase/client'
import { CrmContact } from '@/types/models'

export type AddToCrmOptions = {
  /** Sobrescreve o contact_name da conversation. Útil quando o dialog
   *  de pré-validação coleta um nome editado pelo user. */
  contact_name?: string
  stage?: 'lead' | 'em_atendimento' | 'cliente' | 'perdido'
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
    expand: 'assigned_to',
  })
}

export const updateCrmContactStage = async (id: string, stage: string) => {
  return pb.collection('crm_contacts').update<CrmContact>(id, { stage })
}

export const deleteCrmContact = async (id: string) => {
  return pb.collection('crm_contacts').delete(id)
}
