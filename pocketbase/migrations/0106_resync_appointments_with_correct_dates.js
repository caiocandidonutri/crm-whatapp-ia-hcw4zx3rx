/// <reference path="../pb_data/types.d.ts" />

migrate((app) => {
  // Dispara a sincronia da agenda externa com o parser corrigido de datas e fuso de Brasília
  var syncUrl =
    'https://clinicapro-gestao-clone-35d33.shrd00.internal.goskip.dev/backend/v1/crm-dados?tipo=tudo'
  var token = 'crm_agenda_token_dr_caio_2026'

  function normalizeCity(raw) {
    if (!raw) return 'Teófilo Otoni'
    var s = String(raw).trim()
    var lower = s.toLowerCase()
    if (lower.indexOf('teof') !== -1 || lower.indexOf('teóf') !== -1) return 'Teófilo Otoni'
    if (lower.indexOf('itaob') !== -1) return 'Itaobim'
    if (lower.indexOf('padre') !== -1 || lower.indexOf('para') !== -1) return 'Padre Paraíso'
    return s
  }

  function normalizeStatus(raw) {
    if (!raw) return 'agendado'
    var s = String(raw).toLowerCase().trim()
    if (s === 'realizado' || s === 'atendido' || s === 'concluido' || s === 'concluído')
      return 'realizado'
    if (s === 'cancelado' || s === 'cancelada') return 'cancelado'
    if (s === 'confirmado' || s === 'confirmada') return 'confirmado'
    if (s === 'faltou' || s === 'falta' || s === 'ausente') return 'falta'
    return 'agendado'
  }

  function normalizeAppointmentType(item) {
    var rawType = String(
      (item && (item.tipo_consulta || item.appointment_type || item.tipo || item.procedimento)) ||
        '',
    ).toLowerCase()
    var rawNotes = String(
      (item && (item.notes || item.observacoes || item.descricao)) || '',
    ).toLowerCase()
    var combined = rawType + ' ' + rawNotes

    if (combined.indexOf('retorno') !== -1) return 'retorno'
    if (combined.indexOf('avalia') !== -1 || combined.indexOf('bioimped') !== -1) return 'avaliacao'
    if (combined.indexOf('exame') !== -1) return 'exame'
    if (combined.indexOf('online') !== -1 || combined.indexOf('tele') !== -1) return 'online'
    return 'primeira_vez'
  }

  function parseAppointmentDateUtc(rawDate, rawTime, isEndDate) {
    if (!rawDate) return null
    var s = String(rawDate).trim()
    if (!s) return null

    var brMatch = s.match(
      /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/,
    )
    if (brMatch) {
      var day = parseInt(brMatch[1], 10)
      var month = parseInt(brMatch[2], 10) - 1
      var year = parseInt(brMatch[3], 10)
      var hour = brMatch[4] ? parseInt(brMatch[4], 10) : isEndDate ? 23 : 0
      var min = brMatch[5] ? parseInt(brMatch[5], 10) : isEndDate && !brMatch[4] ? 59 : 0
      var sec = brMatch[6] ? parseInt(brMatch[6], 10) : isEndDate && !brMatch[4] ? 59 : 0

      if (rawTime && !brMatch[4]) {
        var tmMatch = String(rawTime)
          .trim()
          .match(/^(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?/)
        if (tmMatch) {
          hour = parseInt(tmMatch[1], 10)
          min = parseInt(tmMatch[2], 10)
          sec = tmMatch[3] ? parseInt(tmMatch[3], 10) : 0
        }
      }

      var utcMs = Date.UTC(year, month, day, hour + 3, min, sec)
      return new Date(utcMs).toISOString()
    }

    var isoMatch = s.match(
      /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/,
    )
    if (isoMatch) {
      var iYear = parseInt(isoMatch[1], 10)
      var iMonth = parseInt(isoMatch[2], 10) - 1
      var iDay = parseInt(isoMatch[3], 10)
      var hasTimeInString = isoMatch[4] !== undefined

      var iHour = hasTimeInString ? parseInt(isoMatch[4], 10) : isEndDate ? 23 : 0
      var iMin = hasTimeInString
        ? parseInt(isoMatch[5], 10)
        : isEndDate && !hasTimeInString
          ? 59
          : 0
      var iSec =
        hasTimeInString && isoMatch[6]
          ? parseInt(isoMatch[6], 10)
          : isEndDate && !hasTimeInString
            ? 59
            : 0

      if (rawTime && !hasTimeInString) {
        var itmMatch = String(rawTime)
          .trim()
          .match(/^(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?/)
        if (itmMatch) {
          iHour = parseInt(itmMatch[1], 10)
          iMin = parseInt(itmMatch[2], 10)
          sec = itmMatch[3] ? parseInt(itmMatch[3], 10) : 0
          hasTimeInString = true
        }
      }

      if (s.endsWith('Z') || s.match(/[+-]\d{2}:?\d{2}$/)) {
        var parsedWithTz = new Date(s)
        if (!isNaN(parsedWithTz.getTime())) {
          return parsedWithTz.toISOString()
        }
      }

      var iUtcMs = Date.UTC(iYear, iMonth, iDay, iHour + 3, iMin, iSec)
      return new Date(iUtcMs).toISOString()
    }

    try {
      var genericD = new Date(s)
      if (!isNaN(genericD.getTime())) {
        return genericD.toISOString()
      }
    } catch (_) {}

    return null
  }

  function extractAppointments(data) {
    var list = []
    if (!data) return list
    function traverse(node, depth) {
      if (!node || depth > 5) return
      if (Array.isArray(node)) {
        if (node.length > 0) {
          var first = node[0]
          if (first && typeof first === 'object') {
            var k = Object.keys(first).join(' ').toLowerCase()
            if (
              (k.indexOf('data') !== -1 || k.indexOf('start') !== -1 || k.indexOf('hora') !== -1) &&
              (k.indexOf('paciente') !== -1 ||
                k.indexOf('patient') !== -1 ||
                k.indexOf('nome') !== -1)
            ) {
              for (var i = 0; i < node.length; i++) {
                list.push(node[i])
              }
              return
            }
          }
        }
        for (var j = 0; j < node.length; j++) {
          if (typeof node[j] === 'object') traverse(node[j], depth + 1)
        }
      } else if (typeof node === 'object') {
        var direct =
          node.agendamentos ||
          node.appointments ||
          node.consultas ||
          node.atendimentos ||
          node.agenda
        if (Array.isArray(direct)) {
          for (var d = 0; d < direct.length; d++) list.push(direct[d])
        }
        var keys = Object.keys(node)
        for (var ki = 0; ki < keys.length; ki++) {
          var kn = keys[ki]
          if (
            kn === 'agendamentos' ||
            kn === 'appointments' ||
            kn === 'consultas' ||
            kn === 'atendimentos' ||
            kn === 'agenda'
          )
            continue
          if (typeof node[kn] === 'object') traverse(node[kn], depth + 1)
        }
      }
    }
    traverse(data, 0)
    return list
  }

  try {
    var res = $http.send({
      url: syncUrl,
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'X-CRM-Token': token,
        Authorization: 'Bearer ' + token,
      },
      timeout: 15,
    })

    if (res.statusCode >= 200 && res.statusCode < 300 && res.json) {
      var appts = extractAppointments(res.json)
      var appointmentsCol = app.findCollectionByNameOrId('appointments')
      var updatedCount = 0
      var createdCount = 0
      var skippedCount = 0

      for (var i = 0; i < appts.length; i++) {
        var item = appts[i]
        if (!item || typeof item !== 'object') continue

        var rawStartVal =
          item.data_inicio ||
          item.data_consulta ||
          item.data_atendimento ||
          item.data_agendamento ||
          item.data_hora ||
          item.dataHora ||
          item.starts_at ||
          item.start_time ||
          item.horario_inicio ||
          item.data ||
          ''
        var rawTimeVal =
          item.hora || item.horario || item.time || item.hora_inicio || item.start_time || ''
        var startsAtIso = parseAppointmentDateUtc(rawStartVal, rawTimeVal, false)

        if (!startsAtIso) {
          skippedCount++
          continue
        }

        var rawEndVal =
          item.data_fim ||
          item.dataHoraFim ||
          item.ends_at ||
          item.end_time ||
          item.horario_fim ||
          item.data_fim_consulta ||
          ''
        var rawEndTimeVal = item.hora_fim || item.horario_fim || item.end_time || ''
        var endsAtIso = parseAppointmentDateUtc(rawEndVal, rawEndTimeVal, true)
        if (!endsAtIso) {
          var duracaoMin = parseInt(item.duracaoMin || item.duracao || item.duration || '0', 10)
          if (duracaoMin > 0) {
            var stD = new Date(startsAtIso)
            endsAtIso = new Date(stD.getTime() + duracaoMin * 60 * 1000).toISOString()
          } else {
            var dstD = new Date(startsAtIso)
            endsAtIso = new Date(dstD.getTime() + 45 * 60 * 1000).toISOString()
          }
        }

        var extId = String(
          item.id || item.external_id || item._id || item.codigo || item.agendamento_id || '',
        ).trim()

        var patName = (
          item.patient_name ||
          item.paciente_nome ||
          item.patient ||
          item.paciente ||
          item.name ||
          item.nome ||
          'Paciente sem nome'
        ).trim()

        if (!extId) {
          extId = patName + '_' + startsAtIso.slice(0, 16)
        }

        var existing = null
        try {
          existing = app.findFirstRecordByFilter(
            'appointments',
            'external_id = {:eid} && source = "agenda_externa"',
            { eid: extId },
          )
        } catch (_) {}

        if (!existing) {
          try {
            var legacyPref = patName + '_'
            existing = app.findFirstRecordByFilter(
              'appointments',
              'external_id ~ {:pref} && source = "agenda_externa"',
              { pref: legacyPref },
            )
          } catch (_) {}
        }

        var rec = existing || new Record(appointmentsCol)
        var isNew = !existing

        rec.set('source', 'agenda_externa')
        rec.set('external_id', extId)
        rec.set('patient_name', patName)
        rec.set(
          'patient_phone',
          item.patient_phone ||
            item.paciente_telefone ||
            item.phone ||
            item.telefone ||
            item.whatsapp ||
            '',
        )
        rec.set(
          'doctor',
          item.doctor ||
            item.medico ||
            item.nutricionista ||
            (item.profissional && item.profissional.nome ? item.profissional.nome : '') ||
            'Dr. Caio',
        )
        rec.set('city', normalizeCity(item.city || item.cidade || item.location || item.local))
        rec.set('location', item.location || item.local || item.clinica || 'Climed')

        // Atualização da data real da consulta
        rec.set('starts_at', startsAtIso)
        rec.set('ends_at', endsAtIso)
        rec.set(
          'status',
          normalizeStatus(item.status || item.situacao || item.estado || 'agendado'),
        )
        rec.set('appointment_type', normalizeAppointmentType(item))
        rec.set('notes', item.notes || item.observacoes || item.descricao || '')
        rec.set('sync_hash', String(item.updated || item.updated_at || item.id || extId))
        rec.set('last_synced_at', new Date().toISOString())
        rec.set('sync_error', '')

        try {
          app.save(rec)
          if (isNew) createdCount++
          else updatedCount++
        } catch (saveErr) {
          app
            .logger()
            .warn('0106_resync_appointments save error', 'extId', extId, 'error', String(saveErr))
        }
      }

      app
        .logger()
        .info(
          '0106_resync_appointments concluído com sucesso',
          'updated',
          updatedCount,
          'created',
          createdCount,
          'skipped',
          skippedCount,
        )
    }
  } catch (err) {
    app.logger().error('0106_resync_appointments falha geral', 'error', String(err))
  }
})
