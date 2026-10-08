migrate(
  (app) => {
    // FASE 1 - Reclassificação e saneamento de equipe & reconciliação de agendamentos passados
    var nowIso = new Date().toISOString()
    var note = 'Reconciliado — consulta realizada'

    // 1) Reconciliação dos agendamentos PASSADOS com status "confirmado" e data anterior a hoje
    var appts = app.findRecordsByFilter(
      'appointments',
      'status = "confirmado" && ((ends_at != "" && ends_at < {:now}) || ((ends_at = "" || ends_at = null) && starts_at < {:now}))',
      'starts_at',
      500,
      0,
      { now: nowIso },
    )

    var reconciledCount = 0
    for (var a = 0; a < appts.length; a++) {
      var ap = appts[a]
      ap.set('status', 'realizado')
      var currentNotes = ap.getString('notes')
      var updatedNotes = currentNotes ? currentNotes + '\n' + note : note
      ap.set('notes', updatedNotes)
      ap.set('last_synced_at', nowIso)
      app.saveNoValidate(ap)
      reconciledCount++
    }
    console.log('[migration 0130] Agendamentos reconciliados: ' + reconciledCount)

    // 2) Reclassificação da equipe: Dr. Caio (usuário ibvpr83qhfxlhsf) e Michelle / secretária
    // Dr. Caio e Michelle NÃO são pacientes: is_patient = false, role = 'nao_paciente'
    var allContacts = app.findRecordsByFilter('crm_contacts', 'id != ""', 'created', 500, 0)
    var staffPhones = [
      '553599288027',
      '553599716747',
      '553599334379',
      '553598643443',
      '553584312169',
    ]

    var staffUpdated = 0
    for (var i = 0; i < allContacts.length; i++) {
      var c = allContacts[i]
      var ph = (c.getString('phone') || '').replace(/\D/g, '')
      var jid = (c.getString('jid') || '').replace(/\D/g, '')
      var name = (c.getString('contact_name') || c.getString('push_name') || '').toLowerCase()
      var role = c.getString('role') || ''
      var isPat = c.getBool('is_patient')
      var cUserId = c.getString('user_id') || ''

      var isStaff =
        c.id === 'mogbhi32g8ihymn' ||
        c.id === 'n916j0icn93j61p' ||
        c.id === '9nm1ll2zy3uxwc1' ||
        c.id === 'o26a8g25ejo3g1f' ||
        c.id === 'ja3sodzl6fxacof' ||
        c.id === '8b746lwepb8rid3' ||
        c.id === '72uw0makmh3u85r' ||
        c.id === 'k8jzlgbizcvg62s' ||
        c.id === '1tlx87ntonrbh8s' ||
        name.indexOf('dr. caio') >= 0 ||
        name.indexOf('caio candido') >= 0 ||
        name.indexOf('michelle') >= 0 ||
        name.indexOf('secretaria') >= 0 ||
        (name === 'fabiana' && c.getString('contact_name') !== 'Fabiana Alves') ||
        ph === '553599288027' ||
        ph === '553599716747' ||
        ph === '553599334379' ||
        jid === '553599288027' ||
        jid === '553599716747' ||
        jid === '553599334379'

      if (isStaff) {
        var mod = false
        if (isPat) {
          c.set('is_patient', false)
          mod = true
        }
        if (role !== 'nao_paciente') {
          c.set('role', 'nao_paciente')
          mod = true
        }
        if (mod) {
          app.saveNoValidate(c)
          staffUpdated++
        }
      }
    }

    console.log(
      '[migration 0130] Contatos de equipe atualizados (is_patient=false): ' + staffUpdated,
    )
  },
  (app) => {},
)
