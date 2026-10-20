import pb from '@/lib/pocketbase/client'

export interface TeamMember {
  id: string
  user_id: string
  role: 'owner' | 'member'
  name: string
  email: string
  avatar?: string
  joined_at: string
}

export interface TeamInvite {
  id: string
  email: string
  role: 'owner' | 'member'
}

export interface TeamData {
  account: {
    id: string
    name: string
    owner_id: string
  }
  members: TeamMember[]
  invites: TeamInvite[]
}

export const DEFAULT_TEAM_DATA: TeamData = {
  account: {
    id: '',
    name: '',
    owner_id: '',
  },
  members: [],
  invites: [],
}

export const fetchTeam = async (): Promise<TeamData> => {
  try {
    const data = await pb.send<TeamData>('/backend/v1/team/members', { method: 'GET' })
    if (!data || typeof data !== 'object') {
      return DEFAULT_TEAM_DATA
    }
    return {
      account: data.account || DEFAULT_TEAM_DATA.account,
      members: Array.isArray(data.members) ? data.members : [],
      invites: Array.isArray(data.invites) ? data.invites : [],
    }
  } catch (err) {
    console.warn('[fetchTeam] Falha segura ao buscar membros da equipe (retornando fallback):', err)
    return DEFAULT_TEAM_DATA
  }
}

export const inviteMember = async (email: string, role: 'owner' | 'member') => {
  return pb.send<{ success: boolean; invite: any }>('/backend/v1/team/invite', {
    method: 'POST',
    body: JSON.stringify({ email, role }),
    headers: { 'Content-Type': 'application/json' },
  })
}

export const createMember = async (data: {
  name: string
  email: string
  password: string
  role: 'owner' | 'member'
}) => {
  return pb.send<{ success: boolean; user_id: string }>('/backend/v1/team/create-member', {
    method: 'POST',
    body: JSON.stringify(data),
    headers: { 'Content-Type': 'application/json' },
  })
}

export const removeMember = async (userId: string) => {
  return pb.send<{ success: boolean }>('/backend/v1/team/remove', {
    method: 'POST',
    body: JSON.stringify({ user_id: userId }),
    headers: { 'Content-Type': 'application/json' },
  })
}

export const removeInvite = async (inviteId: string) => {
  return pb.send<{ success: boolean }>('/backend/v1/team/remove', {
    method: 'POST',
    body: JSON.stringify({ invite_id: inviteId }),
    headers: { 'Content-Type': 'application/json' },
  })
}

export const leaveAccount = async () => {
  return pb.send<{ success: boolean }>('/backend/v1/team/leave', {
    method: 'POST',
  })
}
