/// <reference path="../pb_data/types.d.ts" />

/**
 * PUSH IMEDIATO DE AGENDAMENTOS CRIADOS/EDITADOS LOCALMENTE (source="crm")
 *
 * Sempre que um agendamento for criado ou atualizado no CRM:
 * - Se source === 'crm', tenta fazer o push imediato para a agenda externa
 * - Autenticação direta via header X-CRM-Token e Authorization: Bearer
 * - Registra sync_error em caso de falha para fila de reprocessamento
 *
 * ATENÇÃO: Todas as declarações de funções devem ficar estritamente DENTRO dos callbacks.
 */

onRecordAfterCreateSuccess((e) => {
  try {
    var record = e.record
    if (!record || record.getString('source') !== 'crm') return e.next()

    var RECOMMENDED_BASE_URL = 'https://clinicapro-gestao-clone-35d33.shrd00.internal.goskip.dev'

    function getPushConfig() {
      var rawUrl = ($secrets.get('AGENDA_SYNC_URL') || $os.getenv('AGENDA_SYNC_URL') || '').trim()
      var rawToken = (
        $secrets.get('AGENDA_CRM_TOKEN') ||
        $os.getenv('AGENDA_CRM_TOKEN') ||
        ''
      ).trim()
      if (!rawToken) rawToken = 'crm_agenda_token_dr_caio_2026'
      if (!rawUrl) {
        return {
          configured: Boolean(RECOMMENDED_BASE_URL && rawToken),
          baseUrl: RECOMMENDED_BASE_URL,
          token: rawToken,
        }
      }

      var normalized = rawUrl
      if (!normalized.startsWith('http://') && !normalized.startsWith('https://')) {
        normalized = 'https://' + normalized
      }

      var qIdx = normalized.indexOf('?')
      var pathAndOrigin = qIdx !== -1 ? normalized.slice(0, qIdx) : normalized
      if (pathAndOrigin.endsWith('/')) {
        pathAndOrigin = pathAndOrigin.slice(0, -1)
      }

      var baseUrl = pathAndOrigin
      var crmDadosIdx = pathAndOrigin.indexOf('/backend/v1/crm-dados')
      if (crmDadosIdx !== -1) {
        baseUrl = pathAndOrigin.slice(0, crmDadosIdx)
      }

      // Se a URL aponta para o site público agendanutri.goskip.app (SPA frontend), usar o backend recomendado
      if (baseUrl.indexOf('agendanutri.goskip.app') !== -1) {
        baseUrl = RECOMMENDED_BASE_URL
      }

      return {
        configured: Boolean(baseUrl && rawToken),
        baseUrl: baseUrl,
        token: rawToken,
      }
    }

    var cfg = getPushConfig()
    if (!cfg.configured) {
      record.set('sync_error', 'Sincronia não configurada (AGENDA_SYNC_URL ausente)')
      $app.saveNoValidate(record)
      return e.next()
    }

    function formatBRDate(d) {
      // Formata a data considerando fuso de Brasília (UTC-3)
      var spOffsetMs = -3 * 3600 * 1000
      var spDate = new Date(d.getTime() + spOffsetMs)
      var day = String(spDate.getUTCDate())
      if (day.length < 2) day = '0' + day
      var month = String(spDate.getUTCMonth() + 1)
      if (month.length < 2) month = '0' + month
      var year = spDate.getUTCFullYear()
      return day + '/' + month + '/' + year
    }

    var extIdForPush = record.getString('external_id')
    var startsAtIso = record.getString('starts_at')
    var startsAtDate = startsAtIso ? new Date(startsAtIso) : new Date()
    var dateBR = formatBRDate(startsAtDate)

    var payload = {
      patient_name: record.getString('patient_name'),
      patient_phone: record.getString('patient_phone'),
      doctor: record.getString('doctor') || 'Dr. Caio',
      city: record.getString('city'),
      location: record.getString('location'),
      starts_at: startsAtIso,
      ends_at: record.getString('ends_at'),
      status: record.getString('status'),
      appointment_type: record.getString('appointment_type') || 'Consulta',
      notes: record.getString('notes'),
      source: 'crm',
      data_inicio: dateBR,
      data_agendamento: dateBR,
    }

    var pushHeaders = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'X-CRM-Token': cfg.token,
      Authorization: 'Bearer ' + cfg.token,
    }

    var pushUrl = cfg.baseUrl + '/api/collections/appointments/records'
    var pushMethod = 'POST'
    if (extIdForPush) {
      pushUrl += '/' + extIdForPush
      pushMethod = 'PATCH'
    }

    try {
      var pushRes = $http.send({
        url: pushUrl,
        method: pushMethod,
        headers: pushHeaders,
        body: JSON.stringify(payload),
        timeout: 4,
      })

      if (pushRes.statusCode >= 200 && pushRes.statusCode < 300) {
        if (pushRes.json && pushRes.json.id) {
          record.set('external_id', pushRes.json.id)
        }
        record.set('last_synced_at', new Date().toISOString())
        record.set('sync_error', '')
        $app.saveNoValidate(record)
        $app.logger().info('agenda_push_appointment (create): success', 'id', record.id)
      } else {
        var pushErr = 'Push HTTP ' + pushRes.statusCode + ': ' + (pushRes.raw || '').slice(0, 200)
        record.set('sync_error', pushErr)
        $app.saveNoValidate(record)
      }
    } catch (pushErrEx) {
      var exString = 'Push falhou: ' + String(pushErrEx).slice(0, 200)
      record.set('sync_error', exString)
      try {
        $app.saveNoValidate(record)
      } catch (_) {}
    }
  } catch (err) {
    $app.logger().error('onRecordAfterCreate appointments error', 'error', String(err))
  }
  return e.next()
}, 'appointments')

onRecordAfterUpdateSuccess((e) => {
  try {
    var record = e.record
    if (!record || record.getString('source') !== 'crm') return e.next()

    var origUpdated = record.original().getString('updated')
    var curUpdated = record.getString('updated')
    var origSync = record.original().getString('last_synced_at')
    var curSync = record.getString('last_synced_at')
    if (origSync !== curSync && origUpdated === curUpdated) {
      return e.next()
    }

    var RECOMMENDED_BASE_URL = 'https://clinicapro-gestao-clone-35d33.shrd00.internal.goskip.dev'

    function getPushConfig() {
      var rawUrl = ($secrets.get('AGENDA_SYNC_URL') || $os.getenv('AGENDA_SYNC_URL') || '').trim()
      var rawToken = (
        $secrets.get('AGENDA_CRM_TOKEN') ||
        $os.getenv('AGENDA_CRM_TOKEN') ||
        ''
      ).trim()
      if (!rawToken) rawToken = 'crm_agenda_token_dr_caio_2026'
      if (!rawUrl) {
        return {
          configured: Boolean(RECOMMENDED_BASE_URL && rawToken),
          baseUrl: RECOMMENDED_BASE_URL,
          token: rawToken,
        }
      }

      var normalized = rawUrl
      if (!normalized.startsWith('http://') && !normalized.startsWith('https://')) {
        normalized = 'https://' + normalized
      }

      var qIdx = normalized.indexOf('?')
      var pathAndOrigin = qIdx !== -1 ? normalized.slice(0, qIdx) : normalized
      if (pathAndOrigin.endsWith('/')) {
        pathAndOrigin = pathAndOrigin.slice(0, -1)
      }

      var baseUrl = pathAndOrigin
      var crmDadosIdx = pathAndOrigin.indexOf('/backend/v1/crm-dados')
      if (crmDadosIdx !== -1) {
        baseUrl = pathAndOrigin.slice(0, crmDadosIdx)
      }

      // Se a URL aponta para o site público agendanutri.goskip.app (SPA frontend), usar o backend recomendado
      if (baseUrl.indexOf('agendanutri.goskip.app') !== -1) {
        baseUrl = RECOMMENDED_BASE_URL
      }

      return {
        configured: Boolean(baseUrl && rawToken),
        baseUrl: baseUrl,
        token: rawToken,
      }
    }

    var cfg = getPushConfig()
    if (!cfg.configured) {
      record.set('sync_error', 'Sincronia não configurada (AGENDA_SYNC_URL ausente)')
      $app.saveNoValidate(record)
      return e.next()
    }

    function formatBRDate(d) {
      // Formata a data considerando fuso de Brasília (UTC-3)
      var spOffsetMs = -3 * 3600 * 1000
      var spDate = new Date(d.getTime() + spOffsetMs)
      var day = String(spDate.getUTCDate())
      if (day.length < 2) day = '0' + day
      var month = String(spDate.getUTCMonth() + 1)
      if (month.length < 2) month = '0' + month
      var year = spDate.getUTCFullYear()
      return day + '/' + month + '/' + year
    }

    var extIdForPush = record.getString('external_id')
    var startsAtIso = record.getString('starts_at')
    var startsAtDate = startsAtIso ? new Date(startsAtIso) : new Date()
    var dateBR = formatBRDate(startsAtDate)

    var payload = {
      patient_name: record.getString('patient_name'),
      patient_phone: record.getString('patient_phone'),
      doctor: record.getString('doctor') || 'Dr. Caio',
      city: record.getString('city'),
      location: record.getString('location'),
      starts_at: startsAtIso,
      ends_at: record.getString('ends_at'),
      status: record.getString('status'),
      appointment_type: record.getString('appointment_type') || 'Consulta',
      notes: record.getString('notes'),
      source: 'crm',
      data_inicio: dateBR,
      data_agendamento: dateBR,
    }

    var pushHeaders = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'X-CRM-Token': cfg.token,
      Authorization: 'Bearer ' + cfg.token,
    }

    var pushUrl = cfg.baseUrl + '/api/collections/appointments/records'
    var pushMethod = 'POST'
    if (extIdForPush) {
      pushUrl += '/' + extIdForPush
      pushMethod = 'PATCH'
    }

    try {
      var pushRes = $http.send({
        url: pushUrl,
        method: pushMethod,
        headers: pushHeaders,
        body: JSON.stringify(payload),
        timeout: 4,
      })

      if (pushRes.statusCode >= 200 && pushRes.statusCode < 300) {
        if (pushRes.json && pushRes.json.id) {
          record.set('external_id', pushRes.json.id)
        }
        record.set('last_synced_at', new Date().toISOString())
        record.set('sync_error', '')
        $app.saveNoValidate(record)
        $app.logger().info('agenda_push_appointment (update): success', 'id', record.id)
      } else {
        var pushErr = 'Push HTTP ' + pushRes.statusCode + ': ' + (pushRes.raw || '').slice(0, 200)
        record.set('sync_error', pushErr)
        $app.saveNoValidate(record)
      }
    } catch (pushErrEx) {
      var exString = 'Push falhou: ' + String(pushErrEx).slice(0, 200)
      record.set('sync_error', exString)
      try {
        $app.saveNoValidate(record)
      } catch (_) {}
    }
  } catch (err) {
    $app.logger().error('onRecordAfterUpdate appointments error', 'error', String(err))
  }
  return e.next()
}, 'appointments')

/**
 * PUSH DE CANCELAMENTO / EXCLUSÃO DE AGENDAMENTO PARA A AGENDA EXTERNA
 *
 * Palavra do usuário: "e, caso ocorra o cancelamento, ocorre a exclusão do nome na agenda"
 * Quando um agendamento for excluído da coleção 'appointments':
 * - Se tiver external_id, envia DELETE para o backend externo
 * - Se o DELETE falhar ou não for suportado pelo backend externo, tenta PATCH status="cancelado"
 */
onRecordAfterDeleteSuccess((e) => {
  try {
    var record = e.record
    if (!record) return e.next()

    var extId = record.getString('external_id')
    if (!extId) return e.next()

    var RECOMMENDED_BASE_URL = 'https://clinicapro-gestao-clone-35d33.shrd00.internal.goskip.dev'
    var rawUrl = ($secrets.get('AGENDA_SYNC_URL') || $os.getenv('AGENDA_SYNC_URL') || '').trim()
    var rawToken =
      ($secrets.get('AGENDA_CRM_TOKEN') || $os.getenv('AGENDA_CRM_TOKEN') || '').trim() ||
      'crm_agenda_token_dr_caio_2026'

    var baseUrl = rawUrl
    if (!baseUrl) {
      baseUrl = RECOMMENDED_BASE_URL
    } else {
      if (!baseUrl.startsWith('http://') && !baseUrl.startsWith('https://')) {
        baseUrl = 'https://' + baseUrl
      }
      var qIdx = baseUrl.indexOf('?')
      if (qIdx !== -1) baseUrl = baseUrl.slice(0, qIdx)
      if (baseUrl.endsWith('/')) baseUrl = baseUrl.slice(0, -1)
      if (baseUrl.indexOf('/backend/v1/crm-dados') !== -1) {
        baseUrl = baseUrl.slice(0, baseUrl.indexOf('/backend/v1/crm-dados'))
      }
      if (baseUrl.indexOf('agendanutri.goskip.app') !== -1) {
        baseUrl = RECOMMENDED_BASE_URL
      }
    }

    var delUrl = baseUrl + '/api/collections/appointments/records/' + extId
    try {
      var delRes = $http.send({
        url: delUrl,
        method: 'DELETE',
        headers: {
          Accept: 'application/json',
          'X-CRM-Token': rawToken,
          Authorization: 'Bearer ' + rawToken,
        },
        timeout: 4,
      })

      if (delRes.statusCode < 200 || delRes.statusCode >= 300) {
        // Fallback: se DELETE retornar erro (ex.: 404, 405 ou 500), tenta PATCH com status="cancelado"
        $http.send({
          url: delUrl,
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            'X-CRM-Token': rawToken,
            Authorization: 'Bearer ' + rawToken,
          },
          body: JSON.stringify({ status: 'cancelado' }),
          timeout: 4,
        })
      }
      $app.logger().info('agenda_push_cancellation (delete): success', 'extId', extId)
    } catch (delHttpErr) {
      $app
        .logger()
        .warn(
          'agenda_push_cancellation (delete): http error',
          'extId',
          extId,
          'error',
          String(delHttpErr),
        )
    }
  } catch (err) {
    $app.logger().error('onRecordAfterDelete appointments error', 'error', String(err))
  }
  return e.next()
}, 'appointments')
