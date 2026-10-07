migrate(
  (app) => {
    // Reclassificador inicial rápido
    var allContacts = app.findRecordsByFilter('crm_contacts', 'id != ""', 'created', 200, 0)
    var allAppts = app.findRecordsByFilter(
      'appointments',
      'status = "confirmado" || status = "realizado"',
      '-starts_at',
      200,
      0,
    )

    // Mapa de telefone do agendamento para última data
    var apptByPhone = {}
    var apptByPatientId = {}
    for (var a = 0; a < allAppts.length; a++) {
      var ap = allAppts[a]
      var pId = ap.getString('patient_id')
      var pPh = (ap.getString('patient_phone') || '').replace(/\D/g, '')
      var sAt = ap.getString('starts_at') || ''
      if (pId && (!apptByPatientId[pId] || sAt > apptByPatientId[pId])) {
        apptByPatientId[pId] = sAt
      }
      if (pPh.length >= 8) {
        var suf = pPh.slice(-8)
        if (!apptByPhone[suf] || sAt > apptByPhone[suf]) {
          apptByPhone[suf] = sAt
        }
      }
    }

    var changedCount = 0
    for (var i = 0; i < allContacts.length; i++) {
      var c = allContacts[i]
      var phone = (c.getString('phone') || '').replace(/\D/g, '')
      var jid = (c.getString('jid') || '').replace(/\D/g, '')
      var name = (c.getString('contact_name') || '').toLowerCase()
      var role = c.getString('role') || ''
      var isPat = c.getBool('is_patient')
      var stage = c.getString('stage') || ''

      var isStaff =
        role === 'nao_paciente' ||
        phone.indexOf('553599288027') >= 0 ||
        jid.indexOf('553599288027') >= 0 ||
        phone.indexOf('553599334379') >= 0 ||
        jid.indexOf('553599334379') >= 0 ||
        name.indexOf('dr. caio') >= 0 ||
        name.indexOf('secretaria') >= 0

      var mod = false
      if (isStaff) {
        if (isPat) {
          c.set('is_patient', false)
          mod = true
        }
        if (role !== 'nao_paciente') {
          c.set('role', 'nao_paciente')
          mod = true
        }
      } else {
        var sufPhone = phone.length >= 8 ? phone.slice(-8) : ''
        var sufJid = jid.length >= 8 ? jid.slice(-8) : ''
        var apptDate =
          apptByPatientId[c.id] ||
          (sufPhone ? apptByPhone[sufPhone] : '') ||
          (sufJid ? apptByPhone[sufJid] : '')

        if (apptDate) {
          if (stage !== 'cliente') {
            c.set('stage', 'cliente')
            mod = true
          }
          if (!isPat) {
            c.set('is_patient', true)
            mod = true
          }
          if (role !== 'paciente') {
            c.set('role', 'paciente')
            mod = true
          }
          if (!c.getString('converted_at')) {
            c.set('converted_at', apptDate.split('T')[0].split(' ')[0])
            mod = true
          }
        }
      }

      if (mod) {
        app.saveNoValidate(c)
        changedCount++
      }
    }

    console.log('[migration 0129] Contatos atualizados: ' + changedCount)
  },
  (app) => {},
)
