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

export const fetchTeam = async (): Promise<TeamData> => {
  return pb.send<TeamData>('/backend/v1/team/members', { method: 'GET' })
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
