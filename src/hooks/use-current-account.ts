import { useState, useEffect, useCallback } from 'react'
import pb from '@/lib/pocketbase/client'
import { useAuth } from '@/hooks/use-auth'

export function useCurrentAccount() {
  const { user } = useAuth()
  const [accountId, setAccountId] = useState<string | null>(null)
  const [role, setRole] = useState<'owner' | 'member' | null>(null)
  const [membershipId, setMembershipId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const fetchAccount = useCallback(async () => {
    if (!user) {
      setAccountId(null)
      setRole(null)
      setMembershipId(null)
      setLoading(false)
      return
    }
    try {
      const record = await pb.collection('account_members').getFirstListItem(`user_id="${user.id}"`)
      setAccountId(record.account_id)
      setRole(record.role as 'owner' | 'member')
      setMembershipId(record.id)
    } catch (err) {
      setAccountId(null)
      setRole(null)
      setMembershipId(null)
    } finally {
      setLoading(false)
    }
  }, [user])

  useEffect(() => {
    fetchAccount()
  }, [fetchAccount])

  // `account` é um shim de conveniência: vários consumidores leem
  // `const { account } = useCurrentAccount()` e usam `account?.id`.
  // Expor o objeto evita o mismatch (antes liam `account` inexistente,
  // `account?.id` virava undefined e as categorias não carregavam).
  const account = accountId ? { id: accountId } : null

  return { accountId, account, role, membershipId, loading, refetch: fetchAccount }
}
