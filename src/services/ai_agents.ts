import pb from '@/lib/pocketbase/client'
import type { AiAgent } from '@/types/models'

export const getAiAgents = async () => {
  return pb.collection<AiAgent>('ai_agents').getFullList({
    sort: 'name',
  })
}

export const createAiAgent = async (data: Partial<AiAgent>, documents?: File[]) => {
  if (documents && documents.length > 0) {
    const formData = new FormData()
    Object.entries(data).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        formData.append(key, String(value))
      }
    })
    documents.forEach((doc) => formData.append('documents', doc))
    return pb.collection<AiAgent>('ai_agents').create(formData)
  }
  return pb.collection<AiAgent>('ai_agents').create(data)
}

export const updateAiAgent = async (
  id: string,
  data: Partial<AiAgent>,
  newDocuments?: File[],
  keptDocuments?: string[],
) => {
  const hasFiles =
    (newDocuments && newDocuments.length > 0) || (keptDocuments && keptDocuments.length > 0)

  if (hasFiles) {
    const formData = new FormData()
    Object.entries(data).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        formData.append(key, String(value))
      }
    })
    if (keptDocuments) {
      keptDocuments.forEach((doc) => formData.append('documents', doc))
    }
    if (newDocuments) {
      newDocuments.forEach((doc) => formData.append('documents', doc))
    }
    return pb.collection<AiAgent>('ai_agents').update(id, formData)
  }
  return pb.collection<AiAgent>('ai_agents').update(id, data)
}

export const deleteAiAgent = async (id: string) => {
  return pb.collection<AiAgent>('ai_agents').delete(id)
}
