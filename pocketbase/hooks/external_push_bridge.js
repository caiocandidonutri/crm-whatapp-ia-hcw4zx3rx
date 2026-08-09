onRecordAfterCreateSuccess((e) => {
  var notif = e.record
  var notifType = notif.getString('type')
  var title = notif.getString('title')
  var body = notif.getString('body') || ''
  var userId = notif.getString('user_id')

  var hasPushProvider = $secrets.has('VAPID_PUBLIC_KEY') && $secrets.has('VAPID_PRIVATE_KEY')

  if (!hasPushProvider) {
    return e.next()
  }

  var accountId = notif.getString('account_id') || ''
  var conversationId = ''
  var contactId = ''
  var taskId = ''
  try {
    conversationId = notif.getString('conversation_id')
  } catch (_) {}
  try {
    contactId = notif.getString('crm_contact_id')
  } catch (_) {}
  try {
    taskId = notif.getString('task_id')
  } catch (_) {}

  var payload = {
    user_id: userId,
    account_id: accountId,
    type: notifType,
    title: title,
    body: body,
    conversation_id: conversationId,
    crm_contact_id: contactId,
    task_id: taskId,
  }

  var subscriptionCol = ''
  try {
    subscriptionCol = $app.findCollectionByNameOrId('push_subscriptions')
    var subs = $app.findRecordsByFilter(
      'push_subscriptions',
      'user_id = {:uid}',
      'created',
      500,
      0,
      { uid: userId },
    )
    for (var i = 0; i < subs.length; i++) {
      var endpoint = subs[i].getString('endpoint')
      var p256dh = subs[i].getString('p256dh')
      var auth = subs[i].getString('auth')
      if (!endpoint || !p256dh || !auth) continue

      $http.send({
        url: endpoint,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          TTL: '86400',
        },
        body: JSON.stringify({
          notification: {
            title: title,
            body: body,
            data: payload,
            tag: notif.id,
          },
        }),
        timeout: 10,
      })
    }
  } catch (_) {}

  return e.next()
}, 'notifications')
