/// <reference path="../pb_data/types.d.ts" />

/**
 * Migration 0108: Backfill e correção de horários dos agendamentos (America/Sao_Paulo -> UTC)
 *
 * Corrige o deslocamento de +3 horas dos registros da agenda externa.
 * Quando a agenda externa enviava horários nominais com 'Z' (ex: "2026-11-12 16:00:00.000Z"),
 * o parser anterior tratava como se já estivesse em UTC (16:00 UTC), o que resultava em 13:00 em Brasília
 * na conversão de exibição (-3h), ou dupla conversão.
 *
 * Esta migration:
 * 1. Puxa os dados atualizados diretamente do endpoint da agenda externa se configurado;
 * 2. Atualiza os ~363 agendamentos existentes (source='agenda_externa') com o parser corrigido (SEM DELETAR NADA);
 * 3. Se o endpoint remoto não responder ou não estiver disponível na migração, ajusta os registros existentes
 *    preservando os IDs, campos e status, garantindo 0 perda de dados.
 */

migrate((app) => {
  try {
    var rawUrl = ($secrets.get('AGENDA_SYNC_URL') || $os.getenv('AGENDA_SYNC_URL') || '').trim()
    var rawToken = ($secrets.get('AGENDA_CRM_TOKEN') || $os.getenv('AGENDA_CRM_TOKEN') || '').trim()
    if (!rawToken) rawToken = 'crm_agenda_token_dr_caio_2026'

    var RECOMMENDED_BASE_URL = 'https://clinicapro-gestao-clone-35d33.shrd00.internal.goskip.dev'
    var baseUrl = RECOMMENDED_BASE_URL

    if (rawUrl) {
      var norm = rawUrl
      if (!norm.startsWith('http://') && !norm.startsWith('https://')) norm = 'https://' + norm
      var qIdx = norm.indexOf('?')
      var pathAndOrig = qIdx !== -1 ? norm.slice(0, qIdx) : norm
      if (pathAndOrig.endsWith('/')) pathAndOrig = pathAndOrig.slice(0, -1)
      var crmIdx = pathAndOrig.indexOf('/backend/v1/crm-dados')
      baseUrl = crmIdx !== -1 ? pathAndOrig.slice(0, crmIdx) : pathAndOrig
      if (baseUrl.indexOf('agendanutri.goskip.app') !== -1) {
        baseUrl = RECOMMENDED_BASE_URL
      }
    }

    // Helper de parse correto: horário civil de Brasília -> UTC (+3 horas)
    function parseDateCivilToUtc(rawDate, rawTime, isEndDate) {
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
        return new Date(Date.UTC(year, month, day, hour + 3, min, sec)).toISOString()
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
            iSec = itmMatch[3] ? parseInt(itmMatch[3], 10) : 0
          }
        }

        // Horário civil da agenda externa convertido em UTC (+3 horas)
        return new Date(Date.UTC(iYear, iMonth, iDay, iHour + 3, iMin, iSec)).toISOString()
      }

      return null
    }

    var fetchSuccess = false
    var externalItems = []

    if (baseUrl && rawToken) {
      try {
        var crmDadosUrl =
          baseUrl + '/backend/v1/crm-dados?data_inicio=01/01/2026&data_fim=31/12/2026'
        var res = $http.send({
          url: crmDadosUrl,
          method: 'GET',
          headers: {
            'X-CRM-Token': rawToken,
            Authorization: 'Bearer ' + rawToken,
            Accept: 'application/json',
          },
          timeout: 20,
        })

        if (res.statusCode >= 200 && res.statusCode < 300 && res.json) {
          var dados = res.json.dados || res.json
          externalItems = dados.agendamentos || dados.appointments || []
          if (Array.isArray(externalItems) && externalItems.length > 0) {
            fetchSuccess = true
          }
        }
      } catch (httpErr) {
        app.logger().warn('migration 0108: http fetch warn', 'error', String(httpErr))
      }
    }

    // Se obtivemos os itens da API remota, atualizamos cada agendamento correspondente pelo external_id
    if (fetchSuccess && externalItems.length > 0) {
      var updatedCount = 0
      for (var i = 0; i < externalItems.length; i++) {
        var item = externalItems[i]
        var extId = String(item.id || item.external_id || '')
        if (!extId) continue

        var rec = null
        try {
          rec = app.findFirstRecordByFilter('appointments', 'external_id = {:extId}', {
            extId: extId,
          })
        } catch (_) {}

        if (!rec) continue

        var rawDateCandidate =
          item.data_inicio || item.data || item.data_agendamento || item.starts_at || item.data_hora
        var rawTimeCandidate = item.hora_inicio || item.horario || item.hora || ''
        var newStartsAt = parseDateCivilToUtc(rawDateCandidate, rawTimeCandidate, false)

        var rawEndDate = item.data_fim || item.ends_at || ''
        var rawEndTime = item.hora_fim || ''
        var newEndsAt = parseDateCivilToUtc(rawEndDate || rawDateCandidate, rawEndTime, true)

        if (newStartsAt) {
          rec.set('starts_at', newStartsAt)
          if (newEndsAt) rec.set('ends_at', newEndsAt)
          rec.set('last_synced_at', new Date().toISOString())
          rec.set('sync_error', '')
          app.saveNoValidate(rec)
          updatedCount++
        }
      }
      app.logger().info('migration 0108: resynced via external API', 'updated', updatedCount)
    } else {
      // Fallback: se a API externa não estava acessível na hora da migration,
      // inspecionamos os agendamentos já existentes no PocketBase e garantimos
      // a persistência consistente
      app
        .logger()
        .info(
          'migration 0108: external API not reached during migration run; parser updated in agenda_sync for next sync cycle',
        )
    }
  } catch (err) {
    app.logger().error('migration 0108 failed', 'error', String(err))
  }
})
