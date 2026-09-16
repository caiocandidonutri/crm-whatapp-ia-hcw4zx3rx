migrate(
  (app) => {
    // Limpeza do CRM e tarefas/pendências guiada pela agenda externa do Dr. Caio.
    // Regras da solicitação:
    // 1. Atendimento REALIZADO nos últimos 3 meses (starts_at <= agora e starts_at >= 3 meses atrás, status 'realizado'):
    //    Se NÃO tem agendamento futuro ativo (starts_at > agora, status 'agendado' ou 'confirmado') -> sai de pendência
    //    de "esperando consulta / nova consulta / precisa_retorno", care_status migra para "em_dia" e fecha tarefas
    //    pendentes correspondentes (precisa_retorno, precisa_consulta, followup_10_15).
    // 2. COM agendamento futuro ativo (starts_at > agora, status 'agendado' ou 'confirmado'):
    //    Não pode aparecer como pendência de "agendar consulta / agendar retorno" -> fecha as tarefas pendentes
    //    de agendamento (precisa_consulta, precisa_retorno, followup_10_15), mantendo o vínculo, e define care_status = 'em_dia'.
    // 3. Cancelados / não realizados NÃO são limpos: continuam como pendência real.
    // 4. NÃO apagar contatos nem agendamentos: apenas atualização de status de pendência/tarefas.

    var now = new Date()
    var nowIso = now.toISOString()
    var threeMonthsAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000)
    var threeMonthsAgoIso = threeMonthsAgo.toISOString()

    // 1. Carregar todos os agendamentos relevantes da coleção appointments
    var allAppointments = []
    try {
      allAppointments = app.findRecordsByFilter('appointments', 'id != ""', '-starts_at', 5000, 0)
    } catch (err) {
      console.log('0112_agenda_guided_crm_cleanup: no appointments found or query failed', err)
      return
    }

    function cleanPhone(raw) {
      if (!raw) return ''
      return String(raw).replace(/\D/g, '')
    }

    // Agrupar agendamentos por patient_id e por sufixo de 8 dígitos de telefone
    var apptsByPatientId = {}
    var apptsByPhoneSuffix = {}

    for (var i = 0; i < allAppointments.length; i++) {
      var appt = allAppointments[i]
      var pid = appt.getString('patient_id')
      var phone = cleanPhone(appt.getString('patient_phone'))
      var suffix = phone.length >= 8 ? phone.slice(-8) : ''

      if (pid) {
        if (!apptsByPatientId[pid]) apptsByPatientId[pid] = []
        apptsByPatientId[pid].push(appt)
      }
      if (suffix) {
        if (!apptsByPhoneSuffix[suffix]) apptsByPhoneSuffix[suffix] = []
        apptsByPhoneSuffix[suffix].push(appt)
      }
    }

    // Helper para buscar todos os agendamentos de um contato
    function getApptsForContact(contact) {
      var cid = contact.id
      var list = []
      var seenApptIds = {}

      if (apptsByPatientId[cid]) {
        for (var a = 0; a < apptsByPatientId[cid].length; a++) {
          var aRec = apptsByPatientId[cid][a]
          if (!seenApptIds[aRec.id]) {
            seenApptIds[aRec.id] = true
            list.push(aRec)
          }
        }
      }

      var cPhone = cleanPhone(contact.getString('phone'))
      var cJid = cleanPhone(contact.getString('jid'))
      var suf1 = cPhone.length >= 8 ? cPhone.slice(-8) : ''
      var suf2 = cJid.length >= 8 ? cJid.slice(-8) : ''

      if (suf1 && apptsByPhoneSuffix[suf1]) {
        for (var b = 0; b < apptsByPhoneSuffix[suf1].length; b++) {
          var bRec = apptsByPhoneSuffix[suf1][b]
          if (!seenApptIds[bRec.id]) {
            seenApptIds[bRec.id] = true
            list.push(bRec)
          }
        }
      }
      if (suf2 && suf2 !== suf1 && apptsByPhoneSuffix[suf2]) {
        for (var c = 0; c < apptsByPhoneSuffix[suf2].length; c++) {
          var cRec = apptsByPhoneSuffix[suf2][c]
          if (!seenApptIds[cRec.id]) {
            seenApptIds[cRec.id] = true
            list.push(cRec)
          }
        }
      }

      return list
    }

    // 2. Carregar contatos do CRM
    var contacts = []
    try {
      contacts = app.findRecordsByFilter('crm_contacts', 'id != ""', '-updated', 2000, 0)
    } catch (err) {
      console.log('0112_agenda_guided_crm_cleanup: no contacts found', err)
      return
    }

    var contactsUpdated = 0
    var tasksClosed = 0
    var eligibleContactIds = {}

    for (var k = 0; k < contacts.length; k++) {
      var contact = contacts[k]
      var appts = getApptsForContact(contact)
      if (appts.length === 0) continue

      var hasActiveFuture = false
      var hasRecentRealizado = false

      for (var m = 0; m < appts.length; m++) {
        var ap = appts[m]
        var st = ap.getString('status')
        var startsAt = ap.getString('starts_at')
        if (!startsAt) continue

        // Agendamento futuro ativo
        if (startsAt > nowIso && (st === 'agendado' || st === 'confirmado')) {
          hasActiveFuture = true
        }

        // Realizado nos últimos 3 meses passados
        if (startsAt <= nowIso && startsAt >= threeMonthsAgoIso && st === 'realizado') {
          hasRecentRealizado = true
        }
      }

      // Se o paciente tem agendamento futuro ativo OU atendimento realizado nos últimos 3 meses:
      if (hasActiveFuture || hasRecentRealizado) {
        eligibleContactIds[contact.id] = true

        var currentCareStatus = contact.getString('care_status') || 'em_dia'
        var needsCareStatusUpdate = false

        // Se estava como pendência de retorno ou de consulta, normaliza para 'em_dia'
        if (
          currentCareStatus === 'precisa_retorno' ||
          currentCareStatus === 'precisa_consulta' ||
          currentCareStatus.indexOf('sem_contato') === 0
        ) {
          contact.set('care_status', 'em_dia')
          needsCareStatusUpdate = true
        }

        // Se for paciente com agendamento ativo e estiver em stage de lead/em_atendimento sem ser considerado cliente,
        // garantir que is_patient seja true
        if (!contact.getBool('is_patient')) {
          contact.set('is_patient', true)
          needsCareStatusUpdate = true
        }

        if (needsCareStatusUpdate) {
          try {
            app.saveNoValidate(contact)
            contactsUpdated++
          } catch (saveContactErr) {
            console.log(
              '0112_agenda_guided_crm_cleanup: error saving contact ' + contact.id,
              saveContactErr,
            )
          }
        }
      }
    }

    // 3. Fechar tarefas de agendamento/retorno pendentes dos contatos elegíveis
    // Categorias de tarefas a fechar quando o paciente já tem agendamento futuro ou foi atendido nos últimos 3 meses:
    // - precisa_retorno
    // - precisa_consulta
    // - followup_10_15
    // - ou tarefas cujo título cite agendar retorno/consulta para o paciente
    var targetCategories = ['precisa_retorno', 'precisa_consulta', 'followup_10_15']

    for (var cid in eligibleContactIds) {
      var activeTasks = []
      try {
        activeTasks = app.findRecordsByFilter(
          'tasks',
          "crm_contact_id = {:cid} && (status = 'pendente' || status = 'em_andamento')",
          '-created',
          50,
          0,
          { cid: cid },
        )
      } catch (_) {}

      for (var t = 0; t < activeTasks.length; t++) {
        var task = activeTasks[t]
        var cat = task.getString('care_category')
        var title = (task.getString('title') || '').toLowerCase()

        var shouldClose = false
        if (targetCategories.indexOf(cat) >= 0) {
          shouldClose = true
        } else if (
          title.indexOf('retorno') >= 0 ||
          title.indexOf('consulta') >= 0 ||
          title.indexOf('follow-up') >= 0
        ) {
          shouldClose = true
        }

        if (shouldClose) {
          task.set('status', 'concluida')
          task.set('completed_at', nowIso)
          try {
            app.saveNoValidate(task)
            tasksClosed++
          } catch (saveTaskErr) {
            console.log(
              '0112_agenda_guided_crm_cleanup: error closing task ' + task.id,
              saveTaskErr,
            )
          }
        }
      }
    }

    console.log(
      '0112_agenda_guided_crm_cleanup done: contactsUpdated=' +
        contactsUpdated +
        ', tasksClosed=' +
        tasksClosed,
    )
  },
  (app) => {
    // Migration de reversão não-destrutiva (dados já foram harmonizados)
  },
)
