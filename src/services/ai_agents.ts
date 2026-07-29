import pb from '@/lib/pocketbase/client'
import type { AiAgent } from '@/types/models'

export const getAiAgents = async () => {
  return pb.collection<AiAgent>('ai_agents').getFullList({
    sort: 'name',
    requestKey: null,
  })
}

export const createAiAgent = async (data: Partial<AiAgent>) => {
  return pb.collection<AiAgent>('ai_agents').create(data)
}

export const updateAiAgent = async (id: string, data: Partial<AiAgent>) => {
  return pb.collection<AiAgent>('ai_agents').update(id, data)
}

export const deleteAiAgent = async (id: string) => {
  return pb.collection<AiAgent>('ai_agents').delete(id)
}
