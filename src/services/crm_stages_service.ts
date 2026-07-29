import pb from '@/lib/pocketbase/client'

export interface CrmStage {
  id: string
  account_id: string
  key: string
  label: string
  color: string
  position: number
  created: string
  updated: string
}

// Etapas padrão criadas para uma conta que ainda não tem pipeline.
// Os keys batem com os valores que crm_contacts.stage já usava (lead,
// em_atendimento, cliente, perdido), então contatos existentes caem nas
// colunas certas após a migração select→text.
export const DEFAULT_STAGES: Array<Pick<CrmStage, 'key' | 'label' | 'color' | 'position'>> = [
  { key: 'lead', label: 'Lead', color: 'blue', position: 0 },
  { key: 'em_atendimento', label: 'Em atendimento', color: 'amber', position: 1 },
  { key: 'cliente', label: 'Cliente', color: 'emerald', position: 2 },
  { key: 'perdido', label: 'Perdido', color: 'rose', position: 3 },
]

async function resolveAccountId(): Promise<string | undefined> {
  const uid = pb.authStore.record?.id
  if (!uid) return undefined
  try {
    const m = await pb.collection('account_members').getFirstListItem(`user_id="${uid}"`)
    return m.account_id as string
  } catch {
    return undefined
  }
}

/** Gera um key (slug) a partir do label. Remove acentos e normaliza. */
export function slugifyStageKey(label: string): string {
  const base = label
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
  return base || 'etapa'
}

export async function listCrmStages(accountId: string): Promise<CrmStage[]> {
  return pb.collection('crm_stages').getFullList<CrmStage>({
    filter: `account_id = "${accountId}"`,
    sort: 'position',
  })
}

export async function createCrmStage(data: Partial<CrmStage>): Promise<CrmStage> {
  const account_id = data.account_id || (await resolveAccountId())
  return pb.collection('crm_stages').create<CrmStage>({ ...data, account_id })
}

export async function updateCrmStage(id: string, data: Partial<CrmStage>): Promise<CrmStage> {
  return pb.collection('crm_stages').update<CrmStage>(id, data)
}

export async function deleteCrmStage(id: string): Promise<void> {
  await pb.collection('crm_stages').delete(id)
}

/** Persiste a nova ordem (position = índice no array). */
export async function reorderCrmStages(orderedIds: string[]): Promise<void> {
  for (let i = 0; i < orderedIds.length; i++) {
    await pb.collection('crm_stages').update(orderedIds[i], { position: i }, { requestKey: null })
  }
}

/** Quantos contatos estão numa etapa (por key). Usado antes de excluir. */
export async function countContactsInStage(stageKey: string): Promise<number> {
  const res = await pb.collection('crm_contacts').getList(1, 1, {
    filter: `stage = "${stageKey}"`,
  })
  return res.totalItems
}

/** Move todos os contatos de uma etapa para outra (ao excluir uma etapa). */
export async function reassignContactsStage(fromKey: string, toKey: string): Promise<void> {
  const contacts = await pb.collection('crm_contacts').getFullList({
    filter: `stage = "${fromKey}"`,
  })
  for (const c of contacts) {
    await pb.collection('crm_contacts').update(c.id, { stage: toKey }, { requestKey: null })
  }
}

/** Cria as etapas padrão para uma conta sem pipeline. Idempotente: o índice
 *  único (account_id, key) faz creates duplicados falharem silenciosamente. */
export async function seedDefaultStages(accountId: string): Promise<CrmStage[]> {
  for (const s of DEFAULT_STAGES) {
    try {
      await pb
        .collection('crm_stages')
        .create({ ...s, account_id: accountId }, { requestKey: null })
    } catch {
      /* já existe — ignora */
    }
  }
  return listCrmStages(accountId)
}
