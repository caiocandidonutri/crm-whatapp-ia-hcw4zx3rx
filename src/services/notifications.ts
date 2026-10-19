import pb from '@/lib/pocketbase/client'
import { safePbQuery, safePbFullList } from '@/lib/pocketbase/resilient'
import { Notification } from '@/types/models'

export const getNotifications = async (page = 1, perPage = 30) => {
  return safePbQuery(
    () =>
      pb.collection('notifications').getList<Notification>(page, perPage, {
        sort: '-created',
        requestKey: null,
      }),
    {
      label: 'getNotifications',
      fallback: {
        page,
        perPage,
        totalItems: 0,
        totalPages: 0,
        items: [],
      },
      timeoutMs: 5000,
      maxRetries: 1,
    },
  )
}

export const getUnreadNotificationCount = async () => {
  try {
    const result = await safePbQuery(
      () =>
        pb.collection('notifications').getList(1, 1, {
          filter: 'read = false',
          requestKey: null,
        }),
      {
        label: 'getUnreadNotificationCount',
        fallback: {
          page: 1,
          perPage: 1,
          totalItems: 0,
          totalPages: 0,
          items: [],
        },
        timeoutMs: 4000,
        maxRetries: 1,
      },
    )
    return result?.totalItems ?? 0
  } catch {
    return 0
  }
}

export const markNotificationAsRead = async (id: string) => {
  return pb
    .collection('notifications')
    .update<Notification>(id, { read: true }, { requestKey: null })
}

export const markAllNotificationsAsRead = async () => {
  try {
    const unread = await safePbFullList<{ id: string }>({
      collection: 'notifications',
      perPage: 200,
      filter: 'read = false',
      label: 'markAllNotificationsAsRead',
    })
    await Promise.all(
      unread.map((n) =>
        pb.collection('notifications').update(n.id, { read: true }, { requestKey: null }),
      ),
    )
  } catch (err) {
    console.warn('[markAllNotificationsAsRead] Erro silencioso:', err)
  }
}
