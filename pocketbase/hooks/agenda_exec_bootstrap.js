/// <reference path="../pb_data/types.d.ts" />

/**
 * Trigger de startup para reprocessar os 4 registros pendentes
 */
onBootstrap((e) => {
  e.next()

  try {
    var rawToken = 'crm_agenda_token_dr_caio_2026'
    var baseUrl = 'https://clinicapro-gestao-clone-35d33.shrd00.internal.goskip.dev'

    function formatLocalDataHora(rawStartsAt) {
      if (!rawStartsAt) return ''
      var s = String(rawStartsAt).trim()
      var m = s.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}(?::\d{2})?)/)
      if (m) {
        var datePart = m[1]
        var timePart = m[2]
        if (timePart.length === 5) timePart += ':00'
        return datePart + ' ' + timePart
      }
      return s
    }

    function mapStatusToExternal(st) {
      var s = String(st || '')
        .toLowerCase()
        .trim()
      if (s === 'confirmado') return 'confirmado'
      if (s === 'realizado') return 'realizado'
      if (s === 'faltou') return 'faltou'
      if (s === 'cancelado') return 'cancelado'
      return 'aguardando'
    }

    var targetIds = ['mtjq6dctrgoz20s', '5829bz3bbq8ubb5', 'im0z7l0kvhqcgpl', 'bj1ix4ecypd2k3t']

    for (var i = 0; i < targetIds.length; i++) {
      var apptId = targetIds[i]
      try {
        var record = $app.findRecordById('appointments', apptId)
        if (!record) continue

        // Se já foi sincronizado com sucesso e tem external_id e não tem sync_error, pula
        if (record.getString('external_id') && !record.getString('sync_error')) {
          continue
        }

        var startsAt = record.getString('starts_at')
        var payload = {
          paciente_nome: record.getString('patient_name'),
          paciente_telefone: record.getString('patient_phone'),
          paciente_cidade: record.getString('city') || 'Carmo do Rio Claro',
          dataHora: formatLocalDataHora(startsAt),
          duracaoMin: 45,
          profissional_nome: record.getString('doctor') || 'Dr. Caio',
          tipo_nome: record.getString('appointment_type') || 'Consulta',
          cidade: record.getString('city') || 'Carmo do Rio Claro',
          status: mapStatusToExternal(record.getString('status')),
          valor: 0,
          observacoes: record.getString('notes') || '',
          id_externo: record.id,
        }

        var pushHeaders = {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'X-CRM-Token': rawToken,
        }

        var pushUrl = baseUrl + '/backend/v1/crm-agendamento'
        var pushMethod = 'POST'
        var extId = record.getString('external_id')
        if (extId) {
          pushUrl += '/' + extId
          pushMethod = 'PATCH'
        }

        var pushRes = null
        var maxRetries = 2
        for (var attempt = 0; attempt <= maxRetries; attempt++) {
          try {
            pushRes = $http.send({
              url: pushUrl,
              method: pushMethod,
              headers: pushHeaders,
              body: JSON.stringify(payload),
              timeout: 60,
            })
            if (pushRes && (pushRes.statusCode < 500 || attempt === maxRetries)) {
              break
            }
          } catch (netErr) {
            if (attempt === maxRetries) throw netErr
          }
        }

        if (pushMethod === 'PATCH' && pushRes && pushRes.statusCode === 404) {
          for (var postAttempt = 0; postAttempt <= maxRetries; postAttempt++) {
            try {
              pushRes = $http.send({
                url: baseUrl + '/backend/v1/crm-agendamento',
                method: 'POST',
                headers: pushHeaders,
                body: JSON.stringify(payload),
                timeout: 60,
              })
              if (pushRes && (pushRes.statusCode < 500 || postAttempt === maxRetries)) {
                break
              }
            } catch (postNetErr) {
              if (postAttempt === maxRetries) throw postNetErr
            }
          }
        }

        if (pushRes.statusCode >= 200 && pushRes.statusCode < 300) {
          var remoteId = ''
          if (pushRes.json) {
            if (pushRes.json.id) remoteId = String(pushRes.json.id)
            else if (pushRes.json.data && pushRes.json.data.id)
              remoteId = String(pushRes.json.data.id)
            else if (pushRes.json.agendamento && pushRes.json.agendamento.id)
              remoteId = String(pushRes.json.agendamento.id)
            else if (pushRes.json.dados && pushRes.json.dados.id)
              remoteId = String(pushRes.json.dados.id)
            else if (pushRes.json.item && pushRes.json.item.id)
              remoteId = String(pushRes.json.item.id)
          }
          if (remoteId) {
            record.set('external_id', remoteId)
          }
          record.set('last_synced_at', new Date().toISOString())
          record.set('sync_error', '')
          $app.saveNoValidate(record)
          $app
            .logger()
            .info('bootstrap reprocess success', 'id', apptId, 'extId', remoteId || extId)
        } else {
          var pushErr = 'Push HTTP ' + pushRes.statusCode + ': ' + (pushRes.raw || '').slice(0, 150)
          record.set('sync_error', pushErr)
          $app.saveNoValidate(record)
          $app.logger().warn('bootstrap reprocess failed', 'id', apptId, 'err', pushErr)
        }
      } catch (ex) {
        $app.logger().error('bootstrap reprocess exception', 'id', apptId, 'err', String(ex))
      }
    }
  } catch (err) {
    $app.logger().error('bootstrap outer error', 'err', String(err))
  }
})
