/// <reference path="../pb_data/types.d.ts" />

/**
 * PUSH IMEDIATO DE AGENDAMENTOS CRIADOS/EDITADOS LOCALMENTE (source="crm")
 * PARA AS ROTAS OFICIAIS DA AGENDA EXTERNA:
 * Base: https://clinicapro-gestao-clone-35d33.shrd00.internal.goskip.dev
 * CRIAR: POST /backend/v1/crm-agendamento
 * ATUALIZAR: PATCH /backend/v1/crm-agendamento/:id
 * CANCELAR: DELETE /backend/v1/crm-agendamento/:id (soft-delete, nunca ?permanente=true)
 * Headers: X-CRM-Token: crm_agenda_token_dr_caio_2026 + Content-Type: application/json
 *
 * Requisitos:
 * - Timeout máximo 4s por requisição
 * - Falha de push NUNCA bloqueia criação/atualização (registra sync_error e segue)
 * - Guardar external_id retornado, limpar sync_error e atualizar last_synced_at
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
      var d = new Date(s)
      if (isNaN(d.getTime())) return s
      var pad = function (n) {
        return n < 10 ? '0' + n : String(n)
      }
      return (
        d.getFullYear() +
        '-' +
        pad(d.getMonth() + 1) +
        '-' +
        pad(d.getDate()) +
        ' ' +
        pad(d.getHours()) +
        ':' +
        pad(d.getMinutes()) +
        ':' +
        pad(d.getSeconds())
      )
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

    function calculateDurationMin(startIso, endIso) {
      if (!startIso || !endIso) return 45
      try {
        var sMs = new Date(startIso).getTime()
        var eMs = new Date(endIso).getTime()
        var diff = Math.round((eMs - sMs) / (60 * 1000))
        if (diff > 0 && diff <= 480) return diff
      } catch (_) {}
      return 45
    }

    var extIdForPush = record.getString('external_id')
    var startsAtIso = record.getString('starts_at')
    var endsAtIso = record.getString('ends_at')
    var localDataHora = formatLocalDataHora(startsAtIso)
    var duracao = calculateDurationMin(startsAtIso, endsAtIso)
    var extStatus = mapStatusToExternal(record.getString('status'))

    var payload = {
      paciente_nome: record.getString('patient_name'),
      paciente_telefone: record.getString('patient_phone'),
      paciente_cidade: record.getString('city') || 'Carmo do Rio Claro',
      dataHora: localDataHora,
      duracaoMin: duracao,
      profissional_nome: record.getString('doctor') || 'Dr. Caio',
      tipo_nome: record.getString('appointment_type') || 'Consulta',
      cidade: record.getString('city') || 'Carmo do Rio Claro',
      status: extStatus,
      valor: 0,
      observacoes: record.getString('notes') || '',
      id_externo: record.id,
    }

    var pushHeaders = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'X-CRM-Token': cfg.token,
    }

    var pushUrl = cfg.baseUrl + '/backend/v1/crm-agendamento'
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

      // Se falhou com 404 no PATCH, tentar POST para registrar
      if (pushMethod === 'PATCH' && pushRes.statusCode === 404) {
        $app.logger().info('agenda_push_appointment: PATCH 404 fallback to POST', 'id', record.id)
        pushRes = $http.send({
          url: cfg.baseUrl + '/backend/v1/crm-agendamento',
          method: 'POST',
          headers: pushHeaders,
          body: JSON.stringify(payload),
          timeout: 4,
        })
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
          .info(
            'agenda_push_appointment (create): success',
            'id',
            record.id,
            'extId',
            remoteId || extIdForPush,
          )
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
      var d = new Date(s)
      if (isNaN(d.getTime())) return s
      var pad = function (n) {
        return n < 10 ? '0' + n : String(n)
      }
      return (
        d.getFullYear() +
        '-' +
        pad(d.getMonth() + 1) +
        '-' +
        pad(d.getDate()) +
        ' ' +
        pad(d.getHours()) +
        ':' +
        pad(d.getMinutes()) +
        ':' +
        pad(d.getSeconds())
      )
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

    function calculateDurationMin(startIso, endIso) {
      if (!startIso || !endIso) return 45
      try {
        var sMs = new Date(startIso).getTime()
        var eMs = new Date(endIso).getTime()
        var diff = Math.round((eMs - sMs) / (60 * 1000))
        if (diff > 0 && diff <= 480) return diff
      } catch (_) {}
      return 45
    }

    var extIdForPush = record.getString('external_id')
    var startsAtIso = record.getString('starts_at')
    var endsAtIso = record.getString('ends_at')
    var localDataHora = formatLocalDataHora(startsAtIso)
    var duracao = calculateDurationMin(startsAtIso, endsAtIso)
    var extStatus = mapStatusToExternal(record.getString('status'))

    var payload = {
      paciente_nome: record.getString('patient_name'),
      paciente_telefone: record.getString('patient_phone'),
      paciente_cidade: record.getString('city') || 'Carmo do Rio Claro',
      dataHora: localDataHora,
      duracaoMin: duracao,
      profissional_nome: record.getString('doctor') || 'Dr. Caio',
      tipo_nome: record.getString('appointment_type') || 'Consulta',
      cidade: record.getString('city') || 'Carmo do Rio Claro',
      status: extStatus,
      valor: 0,
      observacoes: record.getString('notes') || '',
      id_externo: record.id,
    }

    var pushHeaders = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'X-CRM-Token': cfg.token,
    }

    var pushUrl = cfg.baseUrl + '/backend/v1/crm-agendamento'
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

      // Se falhou com 404 no PATCH, tentar POST para registrar
      if (pushMethod === 'PATCH' && pushRes.statusCode === 404) {
        $app.logger().info('agenda_push_appointment: PATCH 404 fallback to POST', 'id', record.id)
        pushRes = $http.send({
          url: cfg.baseUrl + '/backend/v1/crm-agendamento',
          method: 'POST',
          headers: pushHeaders,
          body: JSON.stringify(payload),
          timeout: 4,
        })
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
          .info(
            'agenda_push_appointment (update): success',
            'id',
            record.id,
            'extId',
            remoteId || extIdForPush,
          )
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
 * - Se tiver external_id, envia DELETE para /backend/v1/crm-agendamento/:id (soft-delete deles)
 * - NUNCA usa ?permanente=true
 * - Se o DELETE falhar, tenta PATCH com status="cancelado"
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

    var delUrl = baseUrl + '/backend/v1/crm-agendamento/' + extId
    try {
      var delRes = $http.send({
        url: delUrl,
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'X-CRM-Token': rawToken,
        },
        timeout: 4,
      })

      if (delRes.statusCode < 200 || delRes.statusCode >= 300) {
        // Fallback: se DELETE retornar erro, tenta PATCH com status="cancelado"
        $http.send({
          url: delUrl,
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            'X-CRM-Token': rawToken,
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
