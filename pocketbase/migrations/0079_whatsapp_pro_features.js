migrate(
  (app) => {
    // 1. Atualizar schema de whatsapp_messages com transcription (se ainda não existir)
    var msgCol = app.findCollectionByNameOrId('whatsapp_messages')
    if (!msgCol.fields.getByName('transcription')) {
      msgCol.fields.add(
        new TextField({
          name: 'transcription',
          required: false,
        }),
      )
      app.save(msgCol)
    }

    // 2. Atualizar schema de notifications para suportar tipo 'system' (saúde da instância)
    var notifCol = app.findCollectionByNameOrId('notifications')
    var typeField = notifCol.fields.getByName('type')
    if (typeField) {
      typeField.values = ['message', 'care_alert', 'task', 'system']
      typeField.maxSelect = 1
      app.save(notifCol)
    }

    // 3. Helper de formatação de telefone BR local para a migration
    function formatBrPhone(raw) {
      if (!raw) return ''
      var digits = String(raw).replace(/\D/g, '')
      if (digits.startsWith('55') && digits.length >= 12 && digits.length <= 13) {
        var ddd = digits.slice(2, 4)
        var rest = digits.slice(4)
        if (rest.length === 9) {
          return '(' + ddd + ') ' + rest.slice(0, 5) + '-' + rest.slice(5)
        }
        if (rest.length === 8) {
          return '(' + ddd + ') ' + rest.slice(0, 4) + '-' + rest.slice(4)
        }
      }
      if (digits.length === 11) {
        return '(' + digits.slice(0, 2) + ') ' + digits.slice(2, 7) + '-' + digits.slice(7)
      }
      if (digits.length === 10) {
        return '(' + digits.slice(0, 2) + ') ' + digits.slice(2, 6) + '-' + digits.slice(6)
      }
      return digits ? '+' + digits : ''
    }

    function isInvalidName(name) {
      if (!name) return true
      var trimmed = String(name).trim()
      if (!trimmed) return true
      if (/^\d{10,}$/.test(trimmed)) return true
      var lower = trimmed.toLowerCase()
      if (['você', 'voce', 'eu', 'you', 'me', 'i'].indexOf(lower) !== -1) return true
      return false
    }

    // 4. Resetar picture_fetched_at de conversas sem nome para que o cron re-enriqueça imediatamente
    app
      .db()
      .newQuery(
        "UPDATE conversations SET picture_fetched_at = '' WHERE contact_name = '' OR contact_name IS NULL",
      )
      .execute()

    // 5. Preencher retroativamente contatos do CRM que estavam com contact_name vazio ou JID cru
    try {
      var contacts = app.findRecordsByFilter(
        'crm_contacts',
        "contact_name = '' || contact_name ~ '@'",
        '+created',
        500,
        0,
      )
      for (var i = 0; i < contacts.length; i++) {
        var c = contacts[i]
        var curName = c.getString('contact_name')
        if (isInvalidName(curName)) {
          var candidate = c.getString('push_name')
          if (!isInvalidName(candidate)) {
            c.set('contact_name', candidate)
          } else {
            var formatted = formatBrPhone(c.getString('phone') || c.getString('jid'))
            if (formatted) c.set('contact_name', formatted)
          }
          app.save(c)
        }
      }
    } catch (_) {}
  },
  (app) => {
    try {
      var msgCol = app.findCollectionByNameOrId('whatsapp_messages')
      if (msgCol.fields.getByName('transcription')) {
        msgCol.fields.removeByName('transcription')
        app.save(msgCol)
      }
    } catch (_) {}
  },
)
