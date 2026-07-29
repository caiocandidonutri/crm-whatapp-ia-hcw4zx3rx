import { useEffect, useState, useCallback } from 'react'
import { useCurrentAccount } from '@/hooks/use-current-account'
import { AccountMember, User } from '@/types/models'
import { fetchTeam } from '@/services/team'
import { useRealtime } from '@/hooks/use-realtime'

export type TeamMember = AccountMember & { expand?: { user_id: User } }

export function useTeamMembers() {
  const { accountId } = useCurrentAccount()
  const [members, setMembers] = useState<TeamMember[]>([])
  const [loading, setLoading] = useState(true)

  const loadTeam = useCallback(
    async (isInitial = false) => {
      if (!accountId) {
        if (isInitial) setLoading(false)
        return
      }
      if (isInitial) setLoading(true)
      try {
        const res = await fetchTeam()
        const mappedMembers = res.members.map((m: any) => ({
          id: m.id,
          account_id: accountId,
          user_id: m.user_id,
          role: m.role,
          joined_at: m.joined_at || '',
          created: '',
          updated: '',
          expand: {
            user_id: {
              id: m.user_id,
              name: m.name,
              email: m.email,
              avatar: m.avatar || '',
            } as User,
          },
        })) as TeamMember[]
        setMembers(mappedMembers)
      } catch (err) {
        console.error('Failed to fetch team members', err)
      } finally {
        if (isInitial) setLoading(false)
      }
    },
    [accountId],
  )

  useEffect(() => {
    let isMounted = true
    loadTeam(true).then(() => {
      if (!isMounted) return
    })
    return () => {
      isMounted = false
    }
  }, [loadTeam])

  useRealtime(
    'account_members',
    () => {
      loadTeam(false)
    },
    !!accountId,
  )

  return { members, loading }
}
