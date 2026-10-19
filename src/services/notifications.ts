import pb from '@/lib/pocketbase/client'
import { Notification } from '@/types/models'

export const getNotifications = async (page = 1, perPage = 30) => {
  return pb.collection('notifications').getList<Notification>(page, perPage, {
    sort: '-created',
    requestKey: null,
  })
}

export const getUnreadNotificationCount = async () => {
  try {
    const result = await pb.collection('notifications').getList(1, 1, {
      filter: 'read = false',
      requestKey: null,
    })
    return result.totalItems
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
    const unread = await pb.collection('notifications').getFullList({
      batch: 200,
      filter: 'read = false',
      requestKey: null,
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
