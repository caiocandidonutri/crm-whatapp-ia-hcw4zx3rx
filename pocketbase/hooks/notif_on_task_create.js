onRecordAfterCreateSuccess((e) => {
  var task = e.record
  var accountId = task.getString('account_id') || ''
  if (!accountId) return e.next()

  var title = task.getString('title') || ''
  var assignedTo = task.getString('assigned_to')

  if (!assignedTo) return e.next()

  var notifCol = $app.findCollectionByNameOrId('notifications')
  try {
    var notif = new Record(notifCol)
    notif.set('user_id', assignedTo)
    notif.set('account_id', accountId)
    notif.set('type', 'task')
    notif.set('title', 'Nova tarefa atribuída')
    notif.set('body', title.substring(0, 200))
    notif.set('task_id', task.id)
    $app.saveNoValidate(notif)
  } catch (_) {}

  return e.next()
}, 'tasks')
