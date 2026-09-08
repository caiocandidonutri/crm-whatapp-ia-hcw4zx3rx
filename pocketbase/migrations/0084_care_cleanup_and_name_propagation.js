migrate(
  (app) => {
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

    function isInvalidName(val) {
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
      'Migration 0084: Iniciando limpeza, sincronização de nomes e deduplicação de tarefas...',
    )

    // 1. NEUTRALIZAR TAREFAS DE JIDS INVÁLIDOS (LID números longos ex: +266764847939701, @lid)
    var cancelledInvalidJidTasks = 0
    try {
      var invalidTasks = app.findRecordsByFilter(
        'tasks',
        "title ~ '+2667' || title ~ '+1179' || title ~ '+1517' || title ~ '+1941' || title ~ '+4517' || title ~ '+3772' || title ~ '+2366' || title ~ '+2128' || title ~ '+2625' || title ~ '@lid'",
        '+created',
        500,
        0,
      )
      for (var it = 0; it < invalidTasks.length; it++) {
        var invTask = invalidTasks[it]
        if (invTask.getString('status') !== 'cancelada') {
          invTask.set('status', 'cancelada')
          invTask.set(
            'description',
            '[Neutralizado: JID de dispositivo LID/inválido sem telefone real]',
          )
          app.saveNoValidate(invTask)
          cancelledInvalidJidTasks++
        }
      }
    } catch (e1) {
      console.log('Migration 0084: Erro ao cancelar tarefas de JID inválido:', e1)
    }
    console.log('Migration 0084: Tarefas de JID inválido canceladas:', cancelledInvalidJidTasks)

    // 2. PROPAGAÇÃO EM MASSA CONVERSA -> CRM
    // Para conversas individuais com contact_name válido, copiar para crm_contacts correspondente se vazio
    var syncedNamesCount = 0
    try {
      var convs = app.findRecordsByFilter(
        'conversations',
        "is_group = false && contact_name != '' && contact_name != '.'",
        '+created',
        1000,
        0,
      )

      for (var ci = 0; ci < convs.length; ci++) {
        var conv = convs[ci]
        var convName = conv.getString('contact_name') || ''
        if (isInvalidName(convName)) continue

        var remoteJid = conv.getString('remote_jid') || ''
        var instName = conv.getString('instance_name') || ''
        if (!remoteJid) continue

        var cleanPhone = remoteJid.split('@')[0]
        try {
          var matchedContacts = app.findRecordsByFilter(
            'crm_contacts',
            'jid = {:jid} || phone = {:phone}',
            '+created',
            10,
            0,
            { jid: remoteJid, phone: cleanPhone },
          )
          for (var mc = 0; mc < matchedContacts.length; mc++) {
            var crmContact = matchedContacts[mc]
            var currentCName = crmContact.getString('contact_name') || ''
            if (isInvalidName(currentCName)) {
              crmContact.set('contact_name', convName)
              if (isInvalidName(crmContact.getString('push_name'))) {
                crmContact.set('push_name', convName)
              }
              app.saveNoValidate(crmContact)
              syncedNamesCount++

              // Atualiza também títulos de tarefas pendentes deste contato
              try {
                var cTasks = app.findRecordsByFilter(
                  'tasks',
                  "crm_contact_id = {:cid} && status != 'concluida' && status != 'cancelada'",
                  '+created',
                  20,
                  0,
                  { cid: crmContact.id },
                )
                for (var cti = 0; cti < cTasks.length; cti++) {
                  var ct = cTasks[cti]
                  var oldTitle = ct.getString('title') || ''
                  var prefix = 'Atendimento: '
                  if (oldTitle.indexOf(':') !== -1) {
                    prefix = oldTitle.split(':')[0] + ': '
                  }
                  ct.set('title', prefix + convName)
                  app.saveNoValidate(ct)
                }
              } catch (_) {}
            }
          }
        } catch (_) {}
      }
    } catch (e2) {
      console.log('Migration 0084: Erro na propagação conversa -> CRM:', e2)
    }
    console.log('Migration 0084: Contatos CRM atualizados com nome da conversa:', syncedNamesCount)

    // 3. DEDUPLICAÇÃO DE TAREFAS PENDENTES POR CONTATO
    // Para cada crm_contact_id que possui mais de 1 tarefa ativa, manter a de categoria mais grave e concluir as demais.
    var dedupedTasksCount = 0
    try {
      var severityOrder = [
        'alta_demanda',
        'precisa_consulta',
        'precisa_atencao',
        'precisa_retorno',
        'nao_respondeu',
        'followup_10_15',
        'sem_categoria',
      ]

      var activeTasks = app.findRecordsByFilter(
        'tasks',
        "status = 'pendente' || status = 'em_andamento'",
        '+created',
        1000,
        0,
      )

      var tasksByContact = {}
      for (var at = 0; at < activeTasks.length; at++) {
        var tRecord = activeTasks[at]
        var contactId = tRecord.getString('crm_contact_id')
        if (!contactId) continue
        if (!tasksByContact[contactId]) tasksByContact[contactId] = []
        tasksByContact[contactId].push(tRecord)
      }

      for (var cid in tasksByContact) {
        var group = tasksByContact[cid]
        if (group.length <= 1) continue

        // Ordenar pela hierarquia de gravidade (menor índice = mais grave)
        group.sort(function (a, b) {
          var catA = a.getString('care_category') || 'sem_categoria'
          var catB = b.getString('care_category') || 'sem_categoria'
          var idxA = severityOrder.indexOf(catA)
          var idxB = severityOrder.indexOf(catB)
          if (idxA === -1) idxA = 99
          if (idxB === -1) idxB = 99
          return idxA - idxB
        })

        // Manter group[0], concluir group[1...]
        for (var g = 1; g < group.length; g++) {
          var duplicateTask = group[g]
          duplicateTask.set('status', 'concluida')
          duplicateTask.set('completed_at', new Date().toISOString())
          duplicateTask.set(
            'description',
            (duplicateTask.getString('description') || '') +
              ' [Auto-concluída: deduplicação retroativa]',
          )
          app.saveNoValidate(duplicateTask)
          dedupedTasksCount++
        }
      }
    } catch (e3) {
      console.log('Migration 0084: Erro ao deduplicar tarefas ativas:', e3)
    }
    console.log('Migration 0084: Tarefas duplicadas concluídas:', dedupedTasksCount)

    console.log('Migration 0084 concluída com sucesso.')
  },
  (app) => {
    // down: no-op
  },
)
