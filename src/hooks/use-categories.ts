import { useState, useEffect, useCallback } from 'react'
import pb from '@/lib/pocketbase/client'
import type { Category } from '@/types/models'
import { useRealtime } from '@/hooks/use-realtime'

export function useCategories(accountId?: string) {
  const [categories, setCategories] = useState<Category[]>([])
  const [loading, setLoading] = useState(true)

  const fetchCategories = useCallback(async () => {
    if (!accountId) return
    try {
      const data = await pb.collection('categories').getFullList<Category>({
        filter: `account_id = "${accountId}"`,
        sort: 'name',
      })
      setCategories(data)
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }, [accountId])

  useEffect(() => {
    fetchCategories()
  }, [fetchCategories])

  useRealtime<Category>(
    'categories',
    (e) => {
      if (e.action === 'create' && e.record.account_id === accountId) {
        setCategories((prev) => {
          if (prev.find((c) => c.id === e.record.id)) return prev
          return [...prev, e.record].sort((a, b) => a.name.localeCompare(b.name))
        })
      } else if (e.action === 'update') {
        setCategories((prev) =>
          prev
            .map((c) => (c.id === e.record.id ? e.record : c))
            .sort((a, b) => a.name.localeCompare(b.name)),
        )
      } else if (e.action === 'delete') {
        setCategories((prev) => prev.filter((c) => c.id !== e.record.id))
      }
    },
    !!accountId,
  )

  return { categories, loading, reload: fetchCategories }
}
