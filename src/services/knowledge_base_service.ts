import pb from '@/lib/pocketbase/client'
import type {
  KnowledgeBaseEntry,
  KnowledgeBaseCategory,
  KnowledgeBaseStatus,
  KnowledgeBaseOrigem,
} from '@/types/models'

export interface KnowledgeBaseFilters {
  categoria?: KnowledgeBaseCategory | 'todas'
  status?: KnowledgeBaseStatus | 'todos'
  origem?: KnowledgeBaseOrigem | 'todas'
  search?: string
}

export interface CreateKnowledgeBaseInput {
  categoria: KnowledgeBaseCategory
  titulo: string
  pergunta?: string
  resposta: string
  fonte?: string
  status?: KnowledgeBaseStatus
  origem?: KnowledgeBaseOrigem
}

export interface UpdateKnowledgeBaseInput {
  categoria?: KnowledgeBaseCategory
  titulo?: string
  pergunta?: string
  resposta?: string
  fonte?: string
  status?: KnowledgeBaseStatus
}

export async function listKnowledgeBase(
  accountId: string,
  filters: KnowledgeBaseFilters = {},
): Promise<KnowledgeBaseEntry[]> {
  const filterParts: string[] = []

  if (accountId) {
    filterParts.push(`account_id = "${accountId}"`)
  }

  if (filters.categoria && filters.categoria !== 'todas') {
    filterParts.push(`categoria = "${filters.categoria}"`)
  }

  if (filters.status && filters.status !== 'todos') {
    filterParts.push(`status = "${filters.status}"`)
  }

  if (filters.origem && filters.origem !== 'todas') {
    filterParts.push(`origem = "${filters.origem}"`)
  }

  if (filters.search && filters.search.trim()) {
    const term = filters.search.trim().replace(/["\\]/g, '')
    filterParts.push(`(titulo ~ "${term}" || pergunta ~ "${term}" || resposta ~ "${term}")`)
  }

  const res = await pb.collection('knowledge_base').getFullList<KnowledgeBaseEntry>({
    filter: filterParts.length > 0 ? filterParts.join(' && ') : undefined,
    sort: '-created',
    expand: 'approved_by',
    requestKey: null,
  })

  return res
}

export async function createKnowledgeBaseEntry(
  accountId: string,
  input: CreateKnowledgeBaseInput,
  userId?: string,
): Promise<KnowledgeBaseEntry> {
  const isApproved = input.status === 'aprovada'
  const record = await pb.collection('knowledge_base').create<KnowledgeBaseEntry>({
    account_id: accountId,
    categoria: input.categoria,
    titulo: input.titulo.trim(),
    pergunta: input.pergunta?.trim() || '',
    resposta: input.resposta.trim(),
    fonte: input.fonte?.trim() || 'Manual (equipe da clínica)',
    status: input.status || 'aprovada',
    origem: input.origem || 'humano',
    approved_by: isApproved && userId ? userId : '',
    approved_at: isApproved ? new Date().toISOString() : '',
  })
  return record
}

export async function updateKnowledgeBaseEntry(
  id: string,
  input: UpdateKnowledgeBaseInput,
): Promise<KnowledgeBaseEntry> {
  const payload: Record<string, unknown> = {}
  if (input.categoria !== undefined) payload.categoria = input.categoria
  if (input.titulo !== undefined) payload.titulo = input.titulo.trim()
  if (input.pergunta !== undefined) payload.pergunta = input.pergunta.trim()
  if (input.resposta !== undefined) payload.resposta = input.resposta.trim()
  if (input.fonte !== undefined) payload.fonte = input.fonte.trim()
  if (input.status !== undefined) payload.status = input.status

  const updated = await pb.collection('knowledge_base').update<KnowledgeBaseEntry>(id, payload)
  return updated
}

export async function approveKnowledgeBaseEntry(
  id: string,
  userId: string,
): Promise<KnowledgeBaseEntry> {
  const updated = await pb.collection('knowledge_base').update<KnowledgeBaseEntry>(id, {
    status: 'aprovada',
    approved_by: userId || pb.authStore.model?.id || '',
    approved_at: new Date().toISOString(),
  })
  return updated
}

export async function archiveKnowledgeBaseEntry(id: string): Promise<KnowledgeBaseEntry> {
  const updated = await pb.collection('knowledge_base').update<KnowledgeBaseEntry>(id, {
    status: 'arquivada',
  })
  return updated
}

export async function deleteKnowledgeBaseEntry(id: string): Promise<boolean> {
  await pb.collection('knowledge_base').delete(id)
  return true
}
