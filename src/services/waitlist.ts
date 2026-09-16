import pb from '@/lib/pocketbase/client'
import type { WaitlistEntry, WaitlistStatus } from '@/types/models'

export interface CreateWaitlistInput {
  contact_id?: string
  nome: string
  telefone: string
  tipo_desejado: 'Consulta' | 'Retorno' | 'Consultoria' | 'Bioimpedância' | 'Outro'
  cidade_preferida?: 'Carmo do Rio Claro' | 'Alfenas' | 'Monte Belo' | 'Online' | 'Qualquer'
  periodo_preferido?: 'manha' | 'tarde' | 'qualquer'
  observacao?: string
}

export async function listWaitlist(
  accountId: string,
  statusFilter?: WaitlistStatus | 'todos',
): Promise<WaitlistEntry[]> {
  if (!accountId) return []
  try {
    let filter = `account_id="${accountId}"`
    if (statusFilter && statusFilter !== 'todos') {
      filter += ` && status="${statusFilter}"`
    }

    const records = await pb.collection('waitlist').getFullList<WaitlistEntry>({
      filter,
      sort: 'created',
      expand: 'contact_id',
      requestKey: null,
    })
    return records
  } catch (err) {
    console.error('Erro ao listar lista de espera:', err)
    return []
  }
}

export async function createWaitlistEntry(
  accountId: string,
  input: CreateWaitlistInput,
): Promise<WaitlistEntry> {
  return await pb.collection('waitlist').create<WaitlistEntry>({
    account_id: accountId,
    contact_id: input.contact_id || null,
    nome: input.nome.trim(),
    telefone: input.telefone.trim(),
    tipo_desejado: input.tipo_desejado,
    cidade_preferida: input.cidade_preferida || 'Qualquer',
    periodo_preferido: input.periodo_preferido || 'qualquer',
    observacao: input.observacao?.trim() || '',
    status: 'aguardando',
  })
}

export async function updateWaitlistStatus(
  id: string,
  status: WaitlistStatus,
): Promise<WaitlistEntry> {
  const updateData: Partial<WaitlistEntry> = { status }
  if (status === 'avisado') {
    updateData.avisado_em = new Date().toISOString()
  }
  return await pb.collection('waitlist').update<WaitlistEntry>(id, updateData)
}

export async function deleteWaitlistEntry(id: string): Promise<boolean> {
  return await pb.collection('waitlist').delete(id)
}
