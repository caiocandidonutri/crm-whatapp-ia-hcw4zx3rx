migrate(
  (app) => {
    // Helper de formatação de telefone BR (idêntico ao padrão do projeto)
    function formatBrPhone(raw) {
      if (!raw) return ''
      var digits = String(raw).replace(/\D/g, '')
      if (digits.startsWith('55') && (digits.length === 12 || digits.length === 13)) {
        digits = digits.slice(2)
      }
      if (digits.length === 11) {
        return '(' + digits.slice(0, 2) + ') ' + digits.slice(2, 7) + '-' + digits.slice(7)
      }
      if (digits.length === 10) {
        return '(' + digits.slice(0, 2) + ') ' + digits.slice(2, 6) + '-' + digits.slice(6)
      }
      return digits ? '+' + digits : ''
    }

    function isClinicOrInvalidName(val) {
      if (!val) return true
      var trimmed = String(val).trim()
      if (!trimmed) return true
      if (trimmed.indexOf('@') !== -1) return true
      if (/^[.\-_*#@!?,:;~^`'"]+$/.test(trimmed)) return true
      if (/^\d{10,}$/.test(trimmed)) return true
      if (!/[a-zA-Z\u00C0-\u017F]/.test(trimmed)) return true

      var lower = trimmed.toLowerCase()
      if (
        [
          'você',
          'voce',
          'eu',
          'you',
          'me',
          'i',
          'contato whatsapp',
          'sem nome',
          'null',
          'undefined',
          'desconhecido',
        ].indexOf(lower) !== -1
      ) {
        return true
      }

      if (
        (lower.indexOf('fabiana') !== -1 && lower.indexOf('assistente') !== -1) ||
        (lower.indexOf('assistente') !== -1 &&
          (lower.indexOf('dr.') !== -1 ||
            lower.indexOf('dr ') !== -1 ||
            lower.indexOf('caio') !== -1 ||
            lower.indexOf('nutri') !== -1)) ||
        (lower.indexOf('dr. caio') !== -1 && lower.indexOf('nutri') !== -1) ||
        lower === 'fabiana assistente dr. caio nutricionista' ||
        lower === 'fabiana assistente dr. caio cândido nutri'
      ) {
        return true
      }
      return false
    }

    console.log(
      'Migration 0083: Iniciando limpeza de contatos e tarefas contaminados pelo push_name da clínica...',
    )

    // 1. Identificar crm_contacts contaminados
    var cleanedContactsCount = 0
    try {
      var contacts = app.findRecordsByFilter(
        'crm_contacts',
        "contact_name ~ 'Fabiana Assistente' || push_name ~ 'Fabiana Assistente' || contact_name ~ 'Assistente Dr. Caio' || push_name ~ 'Assistente Dr. Caio'",
        '+created',
        500,
        0,
      )

      if (contacts && contacts.length > 0) {
        for (var i = 0; i < contacts.length; i++) {
          var contact = contacts[i]
          var cName = contact.getString('contact_name') || ''
          var pName = contact.getString('push_name') || ''
          var jid = contact.getString('jid') || ''
          var phone = contact.getString('phone') || jid.split('@')[0] || ''

          var shouldClean = isClinicOrInvalidName(cName) || isClinicOrInvalidName(pName)
          if (shouldClean) {
            contact.set('contact_name', '')
            contact.set('push_name', '')
            // Força re-enriquecimento marcando last_synced_at recente
            contact.set('last_synced_at', new Date().toISOString().replace('T', ' '))
            app.saveNoValidate(contact)
            cleanedContactsCount++

            // Propagar limpeza para tasks vinculadas a este contato
            try {
              var tasks = app.findRecordsByFilter(
                'tasks',
                'crm_contact_id = {:cid}',
                '+created',
                50,
                0,
                { cid: contact.id },
              )
              var cleanPhoneFormatted = formatBrPhone(phone) || 'Contato'

              for (var k = 0; k < tasks.length; k++) {
                var task = tasks[k]
                var title = task.getString('title') || ''
                if (title && isClinicOrInvalidName(title)) {
                  // Substitui no título qualquer menção da assistente pelo telefone formatado
                  var prefix = ''
                  if (title.indexOf(':') !== -1) {
                    prefix = title.split(':')[0] + ': '
                  } else if (title.startsWith('Atendimento')) {
                    prefix = 'Atendimento: '
                  }
                  var newTitle = (prefix ? prefix : '') + cleanPhoneFormatted
                  task.set('title', newTitle)
                  app.saveNoValidate(task)
                }
              }
            } catch (tErr) {
              console.log(
                'Migration 0083: Erro ao atualizar tasks do contato ' + contact.id + ':',
                tErr,
              )
            }
          }
        }
      }
    } catch (cErr) {
      console.log('Migration 0083: Erro ao buscar crm_contacts:', cErr)
    }

    console.log('Migration 0083: crm_contacts limpos:', cleanedContactsCount)

    // 2. Limpar conversations contaminadas e resetar picture_fetched_at para re-enriquecimento
    var cleanedConvsCount = 0
    try {
      var convs = app.findRecordsByFilter(
        'conversations',
        "contact_name ~ 'Fabiana Assistente' || contact_name ~ 'Assistente Dr. Caio'",
        '+created',
        500,
        0,
      )

      if (convs && convs.length > 0) {
        for (var j = 0; j < convs.length; j++) {
          var conv = convs[j]
          var convName = conv.getString('contact_name') || ''
          if (isClinicOrInvalidName(convName)) {
            conv.set('contact_name', '')
            conv.set('picture_fetched_at', '') // permite ao cron buscar imediatamente
            app.saveNoValidate(conv)
            cleanedConvsCount++
          }
        }
      }
    } catch (convErr) {
      console.log('Migration 0083: Erro ao buscar conversations:', convErr)
    }

    console.log('Migration 0083: conversations limpas para re-enriquecimento:', cleanedConvsCount)

    // 3. Limpeza direta via SQL para quaisquer tarefas remanescentes que contenham 'Fabiana Assistente' no título
    try {
      var remainingTasks = app.findRecordsByFilter(
        'tasks',
        "title ~ 'Fabiana Assistente' || title ~ 'Assistente Dr. Caio'",
        '+created',
        200,
        0,
      )
      for (var m = 0; m < remainingTasks.length; m++) {
        var rTask = remainingTasks[m]
        var oldTitle = rTask.getString('title') || ''
        var prefixM = ''
        if (oldTitle.indexOf(':') !== -1) {
          prefixM = oldTitle.split(':')[0] + ': '
        }
        var cid = rTask.getString('crm_contact_id')
        var targetPhone = ''
        if (cid) {
          try {
            var cRec = app.findRecordById('crm_contacts', cid)
            if (cRec) targetPhone = cRec.getString('phone') || cRec.getString('jid') || ''
          } catch (_) {}
        }
        var fallbackDisplay = formatBrPhone(targetPhone) || 'Paciente'
        rTask.set('title', (prefixM ? prefixM : 'Atendimento: ') + fallbackDisplay)
        app.saveNoValidate(rTask)
      }
    } catch (remErr) {
      console.log('Migration 0083: Erro ao limpar tarefas remanescentes:', remErr)
    }

    // 4. Resetar picture_fetched_at de todas as conversas sem contact_name válido para entrar na fila de enriquecimento
    try {
      app
        .db()
        .newQuery(
          "UPDATE conversations SET picture_fetched_at = '' WHERE contact_name = '' OR contact_name IS NULL OR contact_name = '.'",
        )
        .execute()
    } catch (resetErr) {
      console.log('Migration 0083: Erro ao resetar picture_fetched_at:', resetErr)
    }

    console.log('Migration 0083 concluída com sucesso.')
  },
  (app) => {
    // down: idempotente, no-op
  },
)
