/// <reference path="../pb_data/types.d.ts" />

migrate(
  (app) => {
    var collection = app.findCollectionByNameOrId('appointments')

    // 1. Garantir que status contenha 'remarcado' e 'a_confirmar'
    var statusField = collection.fields.getByName('status')
    if (statusField) {
      var vals = statusField.values || statusField.selectValues || []
      var needed = [
        'agendado',
        'confirmado',
        'realizado',
        'faltou',
        'remarcado',
        'cancelado',
        'a_confirmar',
      ]
      var updatedVals = []
      for (var i = 0; i < vals.length; i++) {
        updatedVals.push(vals[i])
      }
      for (var j = 0; j < needed.length; j++) {
        if (updatedVals.indexOf(needed[j]) === -1) {
          updatedVals.push(needed[j])
        }
      }
      if (statusField.values !== undefined) {
        statusField.values = updatedVals
      }
      if (statusField.selectValues !== undefined) {
        statusField.selectValues = updatedVals
      }
    }

    // 2. Adicionar campo rescheduled_to_id se não existir
    var reschedField = collection.fields.getByName('rescheduled_to_id')
    if (!reschedField) {
      collection.fields.addAt(
        collection.fields.length,
        new Field({
          name: 'rescheduled_to_id',
          type: 'relation',
          collectionId: collection.id,
          cascadeDelete: false,
          maxSelect: 1,
          required: false,
        }),
      )
    }

    app.save(collection)

    // 3. Backfill RETROATIVO dos últimos 2 meses:
    // Agendamentos marcados 'cancelado' criados/iniciados nos últimos 60 dias
    // Se o mesmo paciente tiver novo agendamento posterior -> 'remarcado' + rescheduled_to_id
    // Se sumiu sem novo agendamento posterior -> 'a_confirmar'
    var cutoffDateMs = Date.now() - 65 * 24 * 60 * 60 * 1000
    var cutoffIso = new Date(cutoffDateMs).toISOString()

    var cancelledList = []
    try {
      cancelledList = app.findRecordsByFilter(
        'appointments',
        'status = "cancelado" && starts_at >= {:cutoff}',
        'starts_at',
        500,
        0,
        { cutoff: cutoffIso },
      )
    } catch (_) {}

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

    for (var k = 0; k < cancelledList.length; k++) {
      var rec = cancelledList[k]
      var pId = rec.getString('patient_id')
      var pPhone = cleanDigits(rec.getString('patient_phone'))
      var pName = normalizeName(rec.getString('patient_name'))
      var startsAt = rec.getString('starts_at')

      // Buscar agendamento posterior do mesmo paciente
      var subsequent = null

      // 1a tentativa: por patient_id
      if (pId) {
        try {
          subsequent = app.findFirstRecordByFilter(
            'appointments',
            'id != {:thisId} && patient_id = {:pid} && starts_at > {:st} && status != "cancelado"',
            { thisId: rec.id, pid: pId, st: startsAt },
          )
        } catch (_) {}
      }

      // 2a tentativa: por telefone sufixo 8 dígitos
      if (!subsequent && pPhone.length >= 8) {
        var suf = pPhone.slice(-8)
        try {
          var cands = app.findRecordsByFilter(
            'appointments',
            'id != {:thisId} && patient_phone ~ {:suf} && starts_at > {:st} && status != "cancelado"',
            'starts_at',
            5,
            0,
            { thisId: rec.id, suf: suf, st: startsAt },
          )
          if (cands && cands.length > 0) {
            subsequent = cands[0]
          }
        } catch (_) {}
      }

      // 3a tentativa: por nome normalizado se tiver >= 4 chars
      if (!subsequent && pName.length >= 4) {
        try {
          var rawName = rec.getString('patient_name').trim()
          var nameCands = app.findRecordsByFilter(
            'appointments',
            'id != {:thisId} && patient_name ~ {:nm} && starts_at > {:st} && status != "cancelado"',
            'starts_at',
            10,
            0,
            { thisId: rec.id, nm: rawName.split(' ')[0], st: startsAt },
          )
          for (var nc = 0; nc < nameCands.length; nc++) {
            var candNorm = normalizeName(nameCands[nc].getString('patient_name'))
            if (
              candNorm &&
              (candNorm === pName ||
                candNorm.indexOf(pName) !== -1 ||
                pName.indexOf(candNorm) !== -1)
            ) {
              subsequent = nameCands[nc]
              break
            }
          }
        } catch (_) {}
      }

      if (subsequent) {
        rec.set('status', 'remarcado')
        rec.set('rescheduled_to_id', subsequent.id)
        var curNotes = rec.getString('notes') || ''
        var noteAdd =
          'Reclassificado para remarcado (novo agendamento em ' +
          subsequent.getString('starts_at') +
          ')'
        if (curNotes.indexOf('Reclassificado para remarcado') === -1) {
          rec.set('notes', curNotes ? curNotes + ' - ' + noteAdd : noteAdd)
        }
      } else {
        rec.set('status', 'a_confirmar')
        var curNotes2 = rec.getString('notes') || ''
        var noteAdd2 = 'Reclassificado para a_confirmar (sumiu da origem sem novo agendamento)'
        if (curNotes2.indexOf('Reclassificado para a_confirmar') === -1) {
          rec.set('notes', curNotes2 ? curNotes2 + ' - ' + noteAdd2 : noteAdd2)
        }
      }

      try {
        app.saveNoValidate(rec)
      } catch (_) {}
    }
  },
  (app) => {
    // Revert opcional
  },
)
