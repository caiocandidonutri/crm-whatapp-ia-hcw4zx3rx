/// <reference path="../pb_data/types.d.ts" />

migrate(
  (app) => {
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

      // Alvos:
      // Fabiola: agendamento com external_id='5arq7279bp6owp7' (id uqug6bi8dymnx04)
      // Pollyanna: agendamento com external_id='vyv3ez1jdpedmqm' (id h71z7q97o6kp7ok)
      var targetIds = ['uqug6bi8dymnx04', 'h71z7q97o6kp7ok']

      for (var i = 0; i < targetIds.length; i++) {
        var apptId = targetIds[i]
        try {
          var record = app.findRecordById('appointments', apptId)
          if (!record) continue

          var startsAt = record.getString('starts_at')
          var extId = record.getString('external_id')
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
              if (attempt === maxRetries) {
                app.logger().error('migration 0126 push network error: ' + String(netErr))
              }
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
                if (postAttempt === maxRetries) {
                  app
                    .logger()
                    .error('migration 0126 fallback POST network error: ' + String(postNetErr))
                }
              }
            }
          }

          if (pushRes && pushRes.statusCode >= 200 && pushRes.statusCode < 300) {
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
            app.saveNoValidate(record)
          } else if (pushRes) {
            var pushErr =
              'Push HTTP ' + pushRes.statusCode + ': ' + (pushRes.raw || '').slice(0, 150)
            record.set('sync_error', pushErr)
            app.saveNoValidate(record)
          }
        } catch (ex) {
          app.logger().error('migration 0126 error on ' + apptId + ': ' + String(ex))
        }
      }
    } catch (e) {
      app.logger().error('migration 0126 fatal: ' + String(e))
    }
  },
  (app) => {},
)
