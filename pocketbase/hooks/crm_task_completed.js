onRecordAfterUpdateSuccess((e) => {
  var record = e.record

  var newStatus = record.getString('status')
  var oldStatus = record.original().getString('status')

  if (newStatus !== 'concluida' || oldStatus === 'concluida') {
    return e.next()
  }

  var careCategory = record.getString('care_category')
  if (!careCategory || careCategory === 'sem_categoria') {
    return e.next()
  }

  var contactId = record.getString('crm_contact_id')
  if (!contactId) {
    return e.next()
  }

  try {
    var contact = $app.findRecordById('crm_contacts', contactId)

    contact.set('care_status', 'em_dia')
    contact.set('last_synced_at', new Date().toISOString().replace('T', ' '))

    if (careCategory === 'precisa_consulta') {
      if (!contact.getBool('is_patient')) {
        contact.set('is_patient', true)
      }
      if (!contact.getString('converted_at')) {
        contact.set('converted_at', new Date().toISOString().split('T')[0])
      }
      contact.set('stage', 'cliente')
    }

    if (careCategory === 'nao_respondeu') {
      if (contact.getString('stage') === 'nao_respondido') {
        contact.set('stage', 'em_atendimento')
      }
    }

    $app.saveNoValidate(contact)
  } catch (err) {
    $app.logger().error('crm_task_completed: update contact failed', 'error', String(err))
  }

  return e.next()
}, 'tasks')
