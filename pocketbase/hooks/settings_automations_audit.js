// @ts-check
/// <reference path="../pb_data/types.d.ts" />

/**
 * Endpoint GET /backend/v1/settings/automations-audit
 * Retorna os últimos ~30-50 envios de mensagens do sistema (lembretes, recall, pesquisa, fora de horário, alertas)
 * com data/hora formatada em America/Sao_Paulo, paciente/número, tipo inferido e conteúdo.
 */

routerAdd(
  'GET',
  '/backend/v1/settings/automations-audit',
  (e) => {
    try {
      var authRecord = e.auth
      var userId = authRecord ? authRecord.id : ''

      var query = e.requestInfo().query || {}
      var limit = parseInt(query.limit || '35', 10)
      if (isNaN(limit) || limit < 1) limit = 35
      if (limit > 100) limit = 100

      // Buscar mensagens enviadas from_me = true
      var msgs = []
      try {
        msgs = $app.findRecordsByFilter('whatsapp_messages', 'from_me = true', '-created', limit, 0)
      } catch (mErr) {
        $app.logger().warn('audit_query_error', 'err', String(mErr))
      }

      var items = []

      for (var i = 0; i < msgs.length; i++) {
        var m = msgs[i]
        var content = m.getString('content') || ''
        var remoteJid = m.getString('remote_jid') || ''
        var msgId = m.getString('message_id') || ''
        var created = m.getString('created') || ''
        var pushName = m.getString('push_name') || ''
        var status = m.getString('status') || ''

        // Inferir tipo de envio
        var automationType = 'outro'
        var isSystemAutomated = false

        if (
          msgId.indexOf('survey_') === 0 ||
          content.indexOf('experiência com a gente') !== -1 ||
          content.indexOf('De 0 a 10') !== -1
        ) {
          automationType = 'pesquisa_satisfacao'
          isSystemAutomated = true
        } else if (
          msgId.indexOf('ah_') === 0 ||
          content.indexOf('fora do horário de atendimento') !== -1
        ) {
          automationType = 'fora_de_horario'
          isSystemAutomated = true
        } else if (
          content.indexOf('confirmar sua consulta') !== -1 ||
          content.indexOf('confirmar sua presença') !== -1
        ) {
          automationType = 'confirmacao_24h'
          isSystemAutomated = true
        } else if (
          content.indexOf('Lembrete de consulta') !== -1 ||
          content.indexOf('Lembrete de Consulta') !== -1 ||
          content.indexOf('Lembramos da sua consulta') !== -1 ||
          content.indexOf('lembrete') !== -1
        ) {
          automationType = 'lembrete_consulta'
          isSystemAutomated = true
        } else if (
          content.indexOf('Faz uns diazinhos que não conversamos') !== -1 ||
          content.indexOf('reengajamento') !== -1
        ) {
          automationType = 'recall_paciente'
          isSystemAutomated = true
        } else if (pushName === 'Assistente' || pushName === 'IA' || pushName === 'Sistema') {
          automationType = 'ia_automatica'
          isSystemAutomated = true
        }

        // Tentar resolver nome do paciente
        var patientName = pushName || ''
        try {
          var cleanPhone = remoteJid.split('@')[0].replace(/\D/g, '')
          var phoneSuffix = cleanPhone.length >= 8 ? cleanPhone.slice(-8) : cleanPhone
          var contact = $app.findFirstRecordByFilter(
            'crm_contacts',
            'jid = {:jid} || phone ~ {:suf}',
            { jid: remoteJid, suf: phoneSuffix },
          )
          if (contact) {
            patientName =
              contact.getString('contact_name') || contact.getString('push_name') || patientName
          }
        } catch (_) {}

        // Formatar data em America/Sao_Paulo (UTC-3)
        var spFormatted = created
        try {
          if (created) {
            var d = new Date(created)
            var spMs = d.getTime() - 3 * 3600 * 1000
            var spD = new Date(spMs)
            var day = ('0' + spD.getUTCDate()).slice(-2)
            var mon = ('0' + (spD.getUTCMonth() + 1)).slice(-2)
            var yr = spD.getUTCFullYear()
            var hh = ('0' + spD.getUTCHours()).slice(-2)
            var mm = ('0' + spD.getUTCMinutes()).slice(-2)
            var ss = ('0' + spD.getUTCSeconds()).slice(-2)
            spFormatted = day + '/' + mon + '/' + yr + ' ' + hh + ':' + mm + ':' + ss
          }
        } catch (_) {}

        items.push({
          id: m.id,
          remote_jid: remoteJid,
          patient_name: patientName,
          content: content,
          automation_type: automationType,
          is_automated: isSystemAutomated,
          status: status,
          created_at: created,
          created_at_sp: spFormatted,
        })
      }

      return e.json(200, {
        items: items,
        total: items.length,
      })
    } catch (err) {
      $app.logger().error('automations_audit_error', 'err', String(err))
      return e.json(500, { error: 'Erro ao consultar auditoria: ' + String(err) })
    }
  },
  $apis.requireAuth(),
)
