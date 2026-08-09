cronAdd('confirmation_24h', '0 * * * *', () => {
  var nowTs = Math.floor(Date.now() / 1000)

  var allSettings = []
  try {
    allSettings = $app.findRecordsByFilter(
      'care_alert_settings',
      'confirmation_alert_enabled = true',
      '-created',
      500,
      0,
    )
  } catch (err) {
    $app.logger().error('cron_confirmation_24h: query settings failed', 'error', String(err))
    return
  }

  if (!allSettings || allSettings.length === 0) return

  for (var s = 0; s < allSettings.length; s++) {
    try {
      var settings = allSettings[s]
      var accountId = settings.getString('account_id')
      var hoursBefore = settings.getInt('confirmation_hours_before') || 24
      var alertPhone = settings.getString('whatsapp_alert_phone') || ''

      var isSilenced = false
      try {
        var silencePeriods = $app.findRecordsByFilter(
          'care_silence_periods',
          'account_id = {:aid} && enabled = true',
          '-created',
          50,
          0,
          { aid: accountId },
        )
        if (silencePeriods && silencePeriods.length > 0) {
          var silNow = new Date()
          var silHHMM =
            ('0' + silNow.getHours()).slice(-2) + ':' + ('0' + silNow.getMinutes()).slice(-2)
          var silDay = silNow.getDay()
          for (var sp = 0; sp < silencePeriods.length; sp++) {
            var spStart = silencePeriods[sp].getString('start_time')
            var spEnd = silencePeriods[sp].getString('end_time')
            if (!spStart || !spEnd) continue
            var spWdRaw = silencePeriods[sp].get('weekdays')
            var spWd = []
            if (spWdRaw) {
              try {
                var spParsed = typeof spWdRaw === 'string' ? JSON.parse(spWdRaw) : spWdRaw
                if (Array.isArray(spParsed)) spWd = spParsed
              } catch (_) {}
            }
            if (spWd.length > 0 && spWd.indexOf(silDay) === -1) continue
            if (spStart <= spEnd) {
              if (silHHMM >= spStart && silHHMM < spEnd) {
                isSilenced = true
                break
              }
            } else {
              if (silHHMM >= spStart || silHHMM < spEnd) {
                isSilenced = true
                break
              }
            }
          }
        }
      } catch (_) {}
      if (isSilenced) continue

      var targetTs = nowTs + hoursBefore * 3600
      var targetDate = new Date(targetTs * 1000).toISOString().split('T')[0]

      var patients = []
      try {
        patients = $app.findRecordsByFilter(
          'crm_contacts',
          'account_id = {:accId} && is_patient = true && converted_at = {:date}',
          '-created',
          100,
          0,
          { accId: accountId, date: targetDate },
        )
      } catch (err) {
        continue
      }

      if (!patients || patients.length === 0) continue

      for (var i = 0; i < patients.length; i++) {
        var contact = patients[i]
        var contactId = contact.id
        var userId = contact.getString('user_id')
        var contactName =
          contact.getString('contact_name') || contact.getString('push_name') || 'Paciente'
        var convertedAt = contact.getString('converted_at') || targetDate
        var instanceName = contact.getString('instance_name')

        var isDuplicate = false
        try {
          var dupCutoff = new Date(Date.now() - 48 * 3600 * 1000).toISOString()
          $app.findFirstRecordByFilter(
            'care_alerts',
            'crm_contact_id = {:cid} && type = {:t} && created >= {:c}',
            { cid: contactId, t: 'confirmacao_24h', c: dupCutoff },
          )
          isDuplicate = true
        } catch (_) {}

        if (isDuplicate) continue

        var dateStr = convertedAt || targetDate
        var datePart = dateStr.split('T')[0].split(' ')[0]
        var timePart = ''
        if (dateStr.indexOf('T') > -1) {
          var tStr = dateStr.split('T')[1]
          if (tStr) timePart = tStr.substring(0, 5)
        }
        var dp = datePart.split('-')
        var formattedDate = dp.length === 3 ? dp[2] + '/' + dp[1] + '/' + dp[0] : datePart

        var confirmText = ''
        var customReminderText = ''
        var followupRuleId = contact.getString('followup_rule_id')

        if (followupRuleId) {
          try {
            var rule = $app.findRecordById('care_followup_rules', followupRuleId)
            customReminderText = rule.getString('reminder_text') || ''
          } catch (_) {}
        }

        if (customReminderText) {
          confirmText = customReminderText
            .replace(/{nome}/g, contactName)
            .replace(/{data}/g, formattedDate)
            .replace(/{horario}/g, timePart || 'horário combinado')
        } else {
          var agentMessage =
            'Gere uma mensagem de confirmacao de consulta para a paciente ' +
            contactName +
            ' que tem consulta agendada para ' +
            formattedDate +
            (timePart ? ' as ' + timePart : '') +
            '. A mensagem deve ser acolhedora, confirmar a data, e ser curta (max 200 chars). ' +
            'NUNCA inclua diagnostico ou prescricao medica.'

          try {
            var result = $ai.agent('crm-care-agent').chat({
              user_id: userId,
              conversation_id: null,
              message: agentMessage,
            })
            confirmText = result.content || ''
          } catch (agentErr) {
            $app
              .logger()
              .error(
                'cron_confirmation_24h: agent chat failed',
                'contact',
                contactId,
                'error',
                String(agentErr),
              )
          }

          if (!confirmText) {
            confirmText =
              'Ola ' +
              contactName +
              '! Passando para confirmar sua consulta dia ' +
              formattedDate +
              (timePart ? ' as ' + timePart : '') +
              '. Estamos te esperando! 🙏'
          }
        }

        try {
          var alertCol = $app.findCollectionByNameOrId('care_alerts')
          var alertRec = new Record(alertCol)
          alertRec.set('account_id', accountId)
          alertRec.set('type', 'confirmacao_24h')
          alertRec.set('crm_contact_id', contactId)
          alertRec.set('message', confirmText)
          alertRec.set('status', 'pending')
          $app.save(alertRec)

          var alertStatus = 'failed'
          if (alertPhone) {
            var phone = alertPhone.replace(/\D/g, '')
            var apiUrl = $secrets.get('EVOLUTION_API_URL')
            var apiKey = $secrets.get('EVOLUTION_API_KEY')

            if (apiUrl && apiKey && instanceName && phone) {
              var url = apiUrl.endsWith('/') ? apiUrl.slice(0, -1) : apiUrl
              try {
                var res = $http.send({
                  url: url + '/message/sendText/' + instanceName,
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json', apikey: apiKey },
                  body: JSON.stringify({ number: phone, text: confirmText }),
                  timeout: 15,
                })
                alertStatus = res.statusCode === 200 || res.statusCode === 201 ? 'sent' : 'failed'
              } catch (_) {}
            }
          }

          alertRec.set('status', alertStatus)
          alertRec.set('sent_at', new Date().toISOString())
          $app.save(alertRec)
        } catch (alertErr) {
          $app
            .logger()
            .error(
              'cron_confirmation_24h: create alert failed',
              'contact',
              contactId,
              'error',
              String(alertErr),
            )
        }
      }
    } catch (err) {
      $app.logger().error('cron_confirmation_24h: error processing settings', 'error', String(err))
    }
  }
})
