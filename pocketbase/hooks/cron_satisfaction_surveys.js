// @ts-check
/// <reference path="../pb_data/types.d.ts" />

/**
 * Cron diário para Pesquisa de Satisfação Pós-Consulta.
 * Executa todos os dias às 14:37 (Brasília = 17:37 UTC), horário escalonado e incomum
 * para não colidir com outros crons (lembretes às 08:30/19:00, recall às 09:15).
 * Idempotente: filtra agendamentos com status='realizado', sem survey_sent,
 * finalizados há ~3 horas (entre 2h e 12h atrás no mesmo dia).
 * Tom acolhedor da Fabiana: nunca se identifica como IA/robô.
 */

// PESQUISA DE SATISFAÇÃO PÓS-CONSULTA
// Executa 1x ao dia às 14:41 UTC (11:41 Brasília)
// Restaurado da emergência com kill-switch, night shield (21h-07h) e timeout curto (5s)
cronAdd('cron_satisfaction_surveys', '41 14 * * *', () => {
  $app.logger().info('cron_satisfaction_surveys: start')

  try {
    var evoUrl = $secrets.get('EVOLUTION_API_URL') || ''
    var evoKey = $secrets.get('EVOLUTION_API_KEY') || ''
    if (!evoUrl || !evoKey) {
      $app.logger().warn('cron_satisfaction_surveys: Evolution API not configured')
      return
    }
    var baseUrl = evoUrl.endsWith('/') ? evoUrl.slice(0, -1) : evoUrl

    // Janela de busca: concluídos há ~3h (entre 2h e 12h atrás)
    var nowMs = Date.now()
    var minFinishedIso = new Date(nowMs - 12 * 3600 * 1000).toISOString()
    var maxFinishedIso = new Date(nowMs - 2 * 3600 * 1000).toISOString()

    // Buscar instâncias ativas
    var instances = []
    try {
      instances = $app.findRecordsByFilter(
        'whatsapp_instances',
        'status = "open"',
        '-created',
        50,
        0,
      )
    } catch (_) {}

    for (var i = 0; i < instances.length; i++) {
      var inst = instances[i]
      var instName = inst.getString('instance_name')
      var accountId = inst.getString('account_id')
      var userId = inst.getString('user_id')

      if (!accountId) continue

      // Verificar se a pesquisa de satisfação está habilitada nas configurações da conta
      var settings = null
      try {
        settings = $app.findFirstRecordByFilter('care_alert_settings', 'account_id = {:aid}', {
          aid: accountId,
        })
      } catch (_) {}

      // KILL SWITCH GLOBAL: interrompe envio e não marca survey_sent
      if (settings && settings.getBool('global_automations_paused')) {
        $app
          .logger()
          .info(
            'Envio cancelado: automações globais pausadas',
            'cron',
            'satisfaction_surveys',
            'account_id',
            accountId,
          )
        continue
      }

      if (settings && settings.get('survey_enabled') === false) {
        continue
      }

      var q1 =
        (settings && settings.getString('survey_q1')) ||
        'De 0 a 10, como foi sua experiência com a gente hoje? 💚'
      var q2 =
        (settings && settings.getString('survey_q2')) ||
        'Tem algo que poderíamos melhorar no seu atendimento?'

      // Buscar agendamentos realizados sem pesquisa enviada
      var filter =
        'account_id = {:aid} && status = "realizado" && (survey_sent = false || survey_sent = null) && starts_at >= {:minIso} && starts_at <= {:maxIso}'

      var appointments = []
      try {
        appointments = $app.findRecordsByFilter('appointments', filter, 'starts_at', 25, 0, {
          aid: accountId,
          minIso: minFinishedIso,
          maxIso: maxFinishedIso,
        })
      } catch (errFind) {
        $app
          .logger()
          .warn('cron_satisfaction_surveys: error finding appointments', 'err', String(errFind))
        continue
      }

      for (var a = 0; a < appointments.length; a++) {
        var appt = appointments[a]
        var pName = appt.getString('patient_name') || 'Paciente'
        var pPhone = appt.getString('patient_phone') || ''
        var patientId = appt.getString('patient_id')

        if (!pPhone && patientId) {
          try {
            var cRec = $app.findRecordById('crm_contacts', patientId)
            if (cRec) pPhone = cRec.getString('phone') || cRec.getString('jid')
          } catch (_) {}
        }

        var cleanDigits = pPhone.replace(/\D/g, '')
        if (cleanDigits.length < 8) continue
        if (cleanDigits.length === 10 || cleanDigits.length === 11) {
          cleanDigits = '55' + cleanDigits
        }

        var firstName = pName.trim().split(' ')[0]
        var remoteJid = cleanDigits + '@s.whatsapp.net'

        // Verificar se houve conversa recente para não atropelar atendimento humano recente
        var sixtyMinAgoSec = Math.floor(Date.now() / 1000) - 3600
        var recentStaffMsg = false
        try {
          var checkRecent = $app.findRecordsByFilter(
            'whatsapp_messages',
            'remote_jid = {:jid} && from_me = true && timestamp >= {:since}',
            '-timestamp',
            1,
            0,
            { jid: remoteJid, since: sixtyMinAgoSec },
          )
          if (checkRecent && checkRecent.length > 0) recentStaffMsg = true
        } catch (_) {}

        if (recentStaffMsg) continue

        // Mensagem acolhedora da Fabiana com as 2 perguntas
        var surveyText =
          'Olá, ' +
          firstName +
          '! Passando para saber como foi sua experiência com a gente hoje 💚\n\n' +
          '1) ' +
          q1 +
          '\n' +
          '2) ' +
          q2 +
          '\n\n' +
          '(Pode responder com uma nota de 0 a 10 e sua opinião em uma única mensagem, quando puder!)'

        try {
          var sendRes = $http.send({
            url: baseUrl + '/message/sendText/' + instName,
            method: 'POST',
            headers: { 'Content-Type': 'application/json', apikey: evoKey },
            body: JSON.stringify({ number: cleanDigits, text: surveyText }),
            timeout: 5,
          })

          if (sendRes.statusCode >= 200 && sendRes.statusCode < 300) {
            // Marcar no agendamento como survey_sent (idempotência)
            appt.set('survey_sent', true)
            appt.set('survey_sent_at', new Date().toISOString())
            $app.saveNoValidate(appt)

            // Gravar mensagem na timeline
            var outMsgId = 'survey_' + $security.randomString(16)
            try {
              outMsgId = sendRes.json && sendRes.json.key && sendRes.json.key.id
            } catch (_) {}

            var msgRec = new Record($app.findCollectionByNameOrId('whatsapp_messages'))
            msgRec.set('user_id', userId)
            msgRec.set('account_id', accountId)
            msgRec.set('instance_name', instName)
            msgRec.set('remote_jid', remoteJid)
            msgRec.set('from_me', true)
            msgRec.set('message_id', outMsgId)
            msgRec.set('push_name', 'Assistente')
            msgRec.set('content', surveyText)
            msgRec.set('message_type', 'conversation')
            msgRec.set('status', 'pending')
            msgRec.set('timestamp', Math.floor(Date.now() / 1000))
            $app.save(msgRec)

            // Atualizar conversa para aguardar resposta da pesquisa
            try {
              var convRec = $app.findFirstRecordByFilter(
                'conversations',
                'remote_jid = {:jid} && instance_name = {:name}',
                { jid: remoteJid, name: instName },
              )
              if (convRec) {
                convRec.set('awaiting_survey_response', true)
                convRec.set('last_message', surveyText)
                convRec.set('last_message_timestamp', Math.floor(Date.now() / 1000))
                $app.saveNoValidate(convRec)
              }
            } catch (_) {}

            $app.logger().info('survey_sent_success', 'patient', pName, 'phone', cleanDigits)
          } else {
            $app
              .logger()
              .warn('survey_send_http_fail', 'status', sendRes.statusCode, 'body', sendRes.raw)
          }
        } catch (sendErr) {
          $app.logger().error('survey_send_error', 'err', String(sendErr))
        }
      }
    }
  } catch (globalErr) {
    $app.logger().error('cron_satisfaction_surveys_error', 'err', String(globalErr))
  }
})
