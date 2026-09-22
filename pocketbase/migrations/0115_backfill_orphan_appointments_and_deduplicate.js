migrate(
  (app) => {
    // 0115_backfill_orphan_appointments_and_deduplicate.js
    // Backfill one-shot e deduplicação inteligente de agendamentos órfãos
    // 1. Resolução da conta principal da clínica (Conta de Caio Candido)
    var caioAccountId = ''
    try {
      var caioUser = app.findAuthRecordByEmail('_pb_users_auth_', 'caiocandidonutri@hotmail.com')
      if (caioUser) {
        var memberRec = app.findFirstRecordByFilter('account_members', 'user_id = {:uid}', {
          uid: caioUser.id,
        })
        if (memberRec) {
          caioAccountId = memberRec.getString('account_id')
        }
      }
    } catch (_) {}

    if (!caioAccountId) {
      try {
        var anyAccount = app.findFirstRecordByFilter('accounts', '', '-created', 1, 0)
        if (anyAccount && anyAccount.length > 0) {
          caioAccountId = anyAccount[0].id
        }
      } catch (_) {}
    }

    if (!caioAccountId) {
      console.log('0115: Nenhuma conta encontrada para associar agendamentos.')
      return
    }

    console.log('0115: Usando conta padrão para backfill: ' + caioAccountId)

    function cleanDigits(s) {
      if (!s) return ''
      return String(s).replace(/\D/g, '')
    }

    function normalizeName(s) {
      if (!s) return ''
      return String(s)
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]/g, '')
        .trim()
    }

    // 1. BACKFILL de account_id em todos os agendamentos órfãos
    var orphanAppointments = []
    try {
      orphanAppointments = app.findRecordsByFilter(
        'appointments',
        'account_id = "" || account_id = null',
        '-created',
        5000,
        0,
      )
    } catch (err) {
      console.log('0115: Falha ao buscar agendamentos órfãos: ' + err)
    }

    var backfilledCount = 0
    var patientLinkedCount = 0
    var convLinkedCount = 0

    for (var i = 0; i < orphanAppointments.length; i++) {
      var appt = orphanAppointments[i]
      appt.set('account_id', caioAccountId)

      var phoneDigits = cleanDigits(appt.getString('patient_phone'))
      if (phoneDigits.length >= 8) {
        var pSuf = phoneDigits.slice(-8)
        if (!appt.getString('patient_id')) {
          try {
            var pat = app.findFirstRecordByFilter(
              'crm_contacts',
              'phone ~ {:suf} || jid ~ {:suf}',
              { suf: pSuf },
            )
            if (pat) {
              appt.set('patient_id', pat.id)
              patientLinkedCount++
            }
          } catch (_) {}
        }

        if (!appt.getString('conversation_id')) {
          try {
            var conv = app.findFirstRecordByFilter(
              'conversations',
              'remote_jid ~ {:suf} || contact_phone ~ {:suf}',
              { suf: pSuf },
            )
            if (conv) {
              appt.set('conversation_id', conv.id)
              convLinkedCount++
            }
          } catch (_) {}
        }
      }

      try {
        app.saveNoValidate(appt)
        backfilledCount++
      } catch (saveErr) {
        console.log('0115: Erro ao salvar agendamento ' + appt.id + ': ' + saveErr)
      }
    }

    console.log(
      '0115: Backfill concluído. Total atualizados: ' +
        backfilledCount +
        ', pacientes vinculados: ' +
        patientLinkedCount +
        ', conversas vinculadas: ' +
        convLinkedCount,
    )

    // 2. DEDUPLICAÇÃO INTELIGENTE
    // Identificar agendamentos duplicados: mesmo paciente (telefone ou nome) + mesma data/hora (janela de ±15 min)
    // Manter o registro mais recente/completo e preservar confirmações, lembretes e notas
    var allAppointments = []
    try {
      allAppointments = app.findRecordsByFilter('appointments', 'id != ""', 'starts_at', 10000, 0)
    } catch (errAll) {
      console.log('0115: Erro ao listar todos appointments para deduplicação: ' + errAll)
      return
    }

    // Agrupamento em buckets de proximidade temporal (dia ou 15 min)
    // Usaremos uma chave aproximada: data YYYY-MM-DD + hora aproximada
    var duplicateGroups = {}
    for (var a = 0; a < allAppointments.length; a++) {
      var item = allAppointments[a]
      var startsAt = item.getString('starts_at')
      if (!startsAt) continue

      var pNameNorm = normalizeName(item.getString('patient_name'))
      var pPhone = cleanDigits(item.getString('patient_phone'))
      var pKey = pPhone.length >= 8 ? pPhone.slice(-8) : pNameNorm
      if (!pKey) continue

      // Arredonda timestamp em blocos de 15 min para agrupar consultas marcadas no mesmo horário
      var dMs = new Date(startsAt).getTime()
      if (isNaN(dMs)) continue
      var rounded15Min = Math.round(dMs / (15 * 60 * 1000))

      var groupKey = pKey + '_' + rounded15Min
      if (!duplicateGroups[groupKey]) {
        duplicateGroups[groupKey] = []
      }
      duplicateGroups[groupKey].push(item)
    }

    var deduplicatedCount = 0
    for (var gk in duplicateGroups) {
      var group = duplicateGroups[gk]
      if (group.length <= 1) continue

      // Ordenar: o melhor registro para manter primeiro:
      // Critérios:
      // 1. Tem confirmação do paciente ou confirmação enviada (status='confirmado' ou confirmation_sent_at preenchido)
      // 2. Tem vínculo com patient_id ou conversation_id
      // 3. Mais recente por updated / created
      group.sort(function (x, y) {
        var xScore = 0
        var yScore = 0

        if (x.getString('status') === 'confirmado') xScore += 10
        if (y.getString('status') === 'confirmado') yScore += 10

        if (x.getString('confirmation_sent_at')) xScore += 5
        if (y.getString('confirmation_sent_at')) yScore += 5

        if (x.getString('patient_id')) xScore += 3
        if (y.getString('patient_id')) yScore += 3

        if (x.getString('conversation_id')) xScore += 2
        if (y.getString('conversation_id')) yScore += 2

        if (xScore !== yScore) return yScore - xScore

        var xDate = new Date(x.getString('updated') || x.getString('created')).getTime()
        var yDate = new Date(y.getString('updated') || y.getString('created')).getTime()
        return yDate - xDate
      })

      var primary = group[0]

      // Mesclar dados dos duplicados no primário antes de remover
      var primaryNeedsSave = false
      for (var d = 1; d < group.length; d++) {
        var duplicate = group[d]

        if (!primary.getString('patient_phone') && duplicate.getString('patient_phone')) {
          primary.set('patient_phone', duplicate.getString('patient_phone'))
          primaryNeedsSave = true
        }
        if (!primary.getString('patient_id') && duplicate.getString('patient_id')) {
          primary.set('patient_id', duplicate.getString('patient_id'))
          primaryNeedsSave = true
        }
        if (!primary.getString('conversation_id') && duplicate.getString('conversation_id')) {
          primary.set('conversation_id', duplicate.getString('conversation_id'))
          primaryNeedsSave = true
        }
        if (
          !primary.getString('confirmation_sent_at') &&
          duplicate.getString('confirmation_sent_at')
        ) {
          primary.set('confirmation_sent_at', duplicate.getString('confirmation_sent_at'))
          primaryNeedsSave = true
        }
        if (
          !primary.getString('reminder_day_sent_at') &&
          duplicate.getString('reminder_day_sent_at')
        ) {
          primary.set('reminder_day_sent_at', duplicate.getString('reminder_day_sent_at'))
          primaryNeedsSave = true
        }
        if (!primary.getString('followup_sent_at') && duplicate.getString('followup_sent_at')) {
          primary.set('followup_sent_at', duplicate.getString('followup_sent_at'))
          primaryNeedsSave = true
        }
        if (
          !primary.getString('last_interaction_type') &&
          duplicate.getString('last_interaction_type')
        ) {
          primary.set('last_interaction_type', duplicate.getString('last_interaction_type'))
          primaryNeedsSave = true
        }
        if (!primary.getString('notes') && duplicate.getString('notes')) {
          primary.set('notes', duplicate.getString('notes'))
          primaryNeedsSave = true
        }
        if (
          primary.getString('status') !== 'confirmado' &&
          duplicate.getString('status') === 'confirmado'
        ) {
          primary.set('status', 'confirmado')
          primaryNeedsSave = true
        }
        if (!primary.getString('account_id') && duplicate.getString('account_id')) {
          primary.set('account_id', duplicate.getString('account_id'))
          primaryNeedsSave = true
        }

        // Deletar o registro duplicado excedente
        try {
          app.delete(duplicate)
          deduplicatedCount++
        } catch (delErr) {
          console.log('0115: Erro ao remover duplicata ' + duplicate.id + ': ' + delErr)
        }
      }

      if (primaryNeedsSave) {
        try {
          app.saveNoValidate(primary)
        } catch (_) {}
      }
    }

    console.log('0115: Deduplicação concluída. Total de duplicatas removidas: ' + deduplicatedCount)
  },
  (app) => {
    // Reversão não-destrutiva (manter registros únicos limpos)
  },
)
