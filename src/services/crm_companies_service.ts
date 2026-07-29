import pb from '@/lib/pocketbase/client'
import { CrmCompany, CrmContact } from '@/types/models'

/**
 * Resolve o account_id da conta a que o user logado pertence, lendo
 * account_members (mesma lógica do hook useCurrentAccount). Necessário
 * porque a API rule de crm_companies (modelo de accounts, migration
 * 0044) exige que o registro tenha um account_id válido — sem ele o
 * create é rejeitado pelo PocketBase.
 */
async function resolveAccountId(userId: string): Promise<string | undefined> {
  try {
    const membership = await pb
      .collection('account_members')
      .getFirstListItem(`user_id="${userId}"`)
    return membership.account_id as string
  } catch {
    return undefined
  }
}

/**
 * Lista todas as empresas do user logado, ordenadas por nome.
 * RLS server-side garante que só voltam as da account do user atual
 * (regra baseada em account_members na collection).
 */
export async function listCrmCompanies(): Promise<CrmCompany[]> {
  return pb.collection('crm_companies').getFullList<CrmCompany>({
    sort: 'name',
  })
}

/**
 * Busca empresas por nome (LIKE case-insensitive). Usada pelo
 * autocomplete no detail do contato. Retorna até 10 resultados.
 */
export async function searchCrmCompanies(query: string): Promise<CrmCompany[]> {
  const q = query.trim()
  if (!q) return []
  // Escapa aspas pra não quebrar o filter; PB filter usa duplas.
  const safe = q.replace(/"/g, '\\"')
  const res = await pb.collection('crm_companies').getList<CrmCompany>(1, 10, {
    filter: `name ~ "${safe}"`,
    sort: 'name',
  })
  return res.items
}

export async function getCrmCompany(id: string): Promise<CrmCompany> {
  return pb.collection('crm_companies').getOne<CrmCompany>(id)
}

export async function createCrmCompany(data: Partial<CrmCompany>): Promise<CrmCompany> {
  const user_id = pb.authStore.record?.id
  if (!user_id) throw new Error('Not authenticated')

  // A API rule de create exige account_id pertencente à account do
  // user. Se o caller não passou, resolvemos aqui — senão o PocketBase
  // rejeita o create com 403/400.
  const account_id = data.account_id || (await resolveAccountId(user_id))

  return pb.collection('crm_companies').create<CrmCompany>({ ...data, user_id, account_id })
}

export async function updateCrmCompany(id: string, data: Partial<CrmCompany>): Promise<CrmCompany> {
  return pb.collection('crm_companies').update<CrmCompany>(id, data)
}

export async function deleteCrmCompany(id: string): Promise<void> {
  await pb.collection('crm_companies').delete(id)
}

/**
 * Lista contatos do CRM vinculados a uma empresa específica.
 * Usado pelo drawer de detalhe da empresa pra mostrar quem trabalha lá.
 */
export async function listContactsByCompany(companyId: string): Promise<CrmContact[]> {
  return pb.collection('crm_contacts').getFullList<CrmContact>({
    filter: `company_id = "${companyId}"`,
    sort: '-updated',
  })
}

/**
 * Vincula um contato a uma empresa (ou desvincula passando null).
 * String vazia em company_id é o "sem empresa" no PocketBase para
 * relations opcionais.
 */
export async function linkContactToCompany(
  contactId: string,
  companyId: string | null,
): Promise<CrmContact> {
  return pb
    .collection('crm_contacts')
    .update<CrmContact>(contactId, { company_id: companyId || '' })
}
