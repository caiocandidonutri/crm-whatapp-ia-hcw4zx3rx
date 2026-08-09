onRecordAfterCreateSuccess((e) => {
  var alert = e.record
  var accountId = alert.getString('account_id')
  if (!accountId) return e.next()

  var alertType = alert.getString('type')
  var message = alert.getString('message') || ''
  var contactId = ''
  var conversationId = ''

  try {
    contactId = alert.getString('crm_contact_id')
  } catch (_) {}
  try {
    conversationId = alert.getString('conversation_id')
  } catch (_) {}

  var contactName = 'Contato'
  if (contactId) {
    try {
      var contact = $app.findRecordById('crm_contacts', contactId)
      contactName =
        contact.getString('contact_name') || contact.getString('push_name') || contactName
    } catch (_) {}
  }

  var titleMap = {
    followup: 'Follow-up necessário',
    needs_care: 'Cuidado necessário',
    confirmacao_24h: 'Confirmação de consulta',
  }
  var title = (titleMap[alertType] || 'Alerta de cuidado') + ': ' + contactName

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
      notif.set('type', 'care_alert')
      notif.set('title', title)
      notif.set('body', message.substring(0, 200))
      if (contactId) notif.set('crm_contact_id', contactId)
      if (conversationId) notif.set('conversation_id', conversationId)
      $app.saveNoValidate(notif)
    } catch (_) {}
  }

  return e.next()
}, 'care_alerts')
