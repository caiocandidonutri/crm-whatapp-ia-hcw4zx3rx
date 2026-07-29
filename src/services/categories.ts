import pb from '@/lib/pocketbase/client'
import type { Category } from '@/types/models'

/**
 * Resolve o account_id da conta do user logado (account_members).
 * Necessário porque a API rule de categories exige account_id válido.
 */
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

export const listCategories = async (accountId: string) => {
  return pb.collection('categories').getFullList<Category>({
    filter: `account_id = "${accountId}"`,
    sort: '-created',
  })
}

export const createCategory = async (data: Partial<Category>) => {
  // Se o caller não passou account_id (ex.: criação inline pelo picker
  // antes do hook de conta resolver), resolvemos aqui — senão a API rule
  // rejeita o create.
  const account_id = data.account_id || (await resolveAccountId())
  return pb.collection('categories').create<Category>({ ...data, account_id })
}

export const updateCategory = async (id: string, data: Partial<Category>) => {
  return pb.collection('categories').update<Category>(id, data)
}

export const deleteCategory = async (id: string) => {
  return pb.collection('categories').delete(id)
}
