onRecordAfterCreateSuccess((e) => {
  var msg = e.record
  if (msg.getBool('from_me')) return e.next()

  var remoteJid = msg.getString('remote_jid')
  if (!remoteJid || remoteJid.indexOf('@g.us') >= 0 || remoteJid === 'status@broadcast') {
    return e.next()
  }

  var msgTs = msg.getInt('timestamp') || 0
  var nowTs = Math.floor(Date.now() / 1000)
  if (msgTs > 0 && nowTs - msgTs > 300) return e.next()

  var accountId = msg.getString('account_id')
  if (!accountId) return e.next()

  var instanceName = msg.getString('instance_name')
  var contactName = msg.getString('push_name') || remoteJid.split('@')[0]
  var conversationId = ''

  try {
    var conv = $app.findFirstRecordByFilter(
      'conversations',
      'remote_jid = {:jid} && instance_name = {:name}',
      { jid: remoteJid, name: instanceName },
    )
    conversationId = conv.id
    var cname = conv.getString('contact_name')
    if (cname) contactName = cname
  } catch (_) {}

  var content = msg.getString('content') || '[mídia]'
  var body = content.substring(0, 200)

  var members = []
  try {
    members = $app.findRecordsByFilter(
      'account_members',
      'account_id = {:accId}',
      'created',
      500,
      0,
      { accId: accountId },
    )
  } catch (_) {}

  var notifCol = $app.findCollectionByNameOrId('notifications')

  for (var i = 0; i < members.length; i++) {
    var memberUserId = members[i].getString('user_id')
    try {
      var notif = new Record(notifCol)
      notif.set('user_id', memberUserId)
      notif.set('account_id', accountId)
      notif.set('type', 'message')
      notif.set('title', contactName)
      notif.set('body', body)
      if (conversationId) notif.set('conversation_id', conversationId)
      $app.saveNoValidate(notif)
    } catch (_) {}
  }

  return e.next()
}, 'whatsapp_messages')
