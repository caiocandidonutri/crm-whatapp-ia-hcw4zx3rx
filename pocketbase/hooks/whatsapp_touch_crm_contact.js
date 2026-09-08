// Hook que conecta a chegada de uma nova mensagem no WhatsApp (whatsapp_messages)
// ao ciclo de vida de CRM do contato (crm_contacts).
//
// Ao salvar uma mensagem em `whatsapp_messages`, este hook localiza o
// contato em `crm_contacts` (ou cria se não existir) e atualiza o campo
// `last_synced_at`. Essa alteração dispara o hook `crm_care_reclassify_tasks`
// (onRecordAfterUpdateSuccess em `crm_contacts`), permitindo que as tarefas
// do Kanban sejam reclassificadas imediatamente em tempo real (ex.: concluindo
// a tarefa "Não respondeu" quando o paciente envia nova mensagem).

onRecordAfterCreateSuccess((e) => {
  try {
    var msg = e.record
    var remoteJid = msg.getString('remote_jid')
    if (!remoteJid || remoteJid.endsWith('@g.us') || remoteJid === 'status@broadcast') {
      return e.next()
    }

    var instanceName = msg.getString('instance_name') || ''
    var userId = msg.getString('user_id') || ''
    var accountId = msg.getString('account_id') || ''

    // Ignora instâncias desconectadas ou inexistentes
    if (!instanceName) return e.next()
    try {
      var instRec = $app.findFirstRecordByFilter('whatsapp_instances', 'instance_name = {:name}', {
        name: instanceName,
      })
      if (!instRec || instRec.getString('status') !== 'connected') {
        return e.next()
      }
    } catch (_) {
      // Instância inexistente ou erro = desconectada, pular
      return e.next()
    }

    var fromMe = msg.getBool('from_me')

    var contact = null
    try {
      contact = $app.findFirstRecordByFilter(
        'crm_contacts',
        'instance_name = {:inst} && jid = {:jid}',
        { inst: instanceName, jid: remoteJid },
      )
    } catch (_) {}

    var nowIso = new Date().toISOString().replace('T', ' ')
    var pushName = msg.getString('push_name') || ''
    var isInvalidPushName =
      !pushName ||
      pushName.trim() === '.' ||
      /^[.\-_*#@!?,:;~^`'"]+$/.test(pushName.trim()) ||
      !/[a-zA-Z\u00C0-\u017F]/.test(pushName.trim()) ||
      ['você', 'voce', 'eu', 'you', 'me', 'i', 'contato whatsapp', 'sem nome'].indexOf(
        pushName.trim().toLowerCase(),
      ) !== -1

    if (contact) {
      contact.set('last_synced_at', nowIso)
      if (!contact.getString('account_id') && accountId) {
        contact.set('account_id', accountId)
      }
      // Item 3: Quando a mensagem for do paciente (!from_me):
      // se contact.stage === 'nao_respondido' -> setar 'em_atendimento'
      // se contact.care_status === 'nao_respondeu' -> setar 'em_dia'
      if (!fromMe) {
        if (contact.getString('stage') === 'nao_respondido') {
          contact.set('stage', 'em_atendimento')
        }
        if (contact.getString('care_status') === 'nao_respondeu') {
          contact.set('care_status', 'em_dia')
        }
      }
      // Se push_name for válido e o contato estiver sem contact_name válido, atualiza
      if (!isInvalidPushName) {
        var currentContactName = contact.getString('contact_name') || ''
        if (
          !currentContactName ||
          currentContactName === '.' ||
          /^[.\-_*#@!?,:;~^`'"]+$/.test(currentContactName.trim()) ||
          !/[a-zA-Z\u00C0-\u017F]/.test(currentContactName.trim())
        ) {
          contact.set('contact_name', pushName)
          contact.set('push_name', pushName)
        }
      }
      try {
        $app.save(contact)
      } catch (saveErr) {
        $app.logger().error('whatsapp_touch_crm_contact: update failed', 'error', String(saveErr))
      }
    } else {
      try {
        var contactCol = $app.findCollectionByNameOrId('crm_contacts')
        var newContact = new Record(contactCol)
        newContact.set('user_id', userId)
        if (accountId) newContact.set('account_id', accountId)
        newContact.set('instance_name', instanceName)
        newContact.set('jid', remoteJid)
        newContact.set('phone', remoteJid.split('@')[0])
        var safePushName = isInvalidPushName ? '' : pushName
        newContact.set('push_name', safePushName)
        newContact.set('contact_name', safePushName)
        // Se a mensagem for do paciente (!from_me), estágio é 'em_atendimento'; caso contrário 'lead'
        newContact.set('stage', !fromMe ? 'em_atendimento' : 'lead')
        newContact.set('care_status', 'em_dia')
        newContact.set('last_synced_at', nowIso)
        $app.save(newContact)
      } catch (createErr) {
        $app.logger().error('whatsapp_touch_crm_contact: create failed', 'error', String(createErr))
      }
    }
  } catch (err) {
    $app.logger().error('whatsapp_touch_crm_contact: unexpected error', 'error', String(err))
  }

  return e.next()
}, 'whatsapp_messages')
