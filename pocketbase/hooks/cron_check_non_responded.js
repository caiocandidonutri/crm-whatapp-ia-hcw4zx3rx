cronAdd('check_non_responded', '0 * * * *', () => {
  const nowTs = Math.floor(Date.now() / 1000)
  const cutoffTs = nowTs - 8 * 60 * 60

  let conversations = []
  try {
    conversations = $app.findRecordsByFilter(
      'conversations',
      'is_group = false && last_message_timestamp > 0 && last_message_timestamp < {:cutoff}',
      '-last_message_timestamp',
      200,
      0,
      { cutoff: cutoffTs },
    )
  } catch (err) {
    $app.logger().error('cron_non_responded_query_error', 'error', String(err))
    return
  }

  if (!conversations || conversations.length === 0) return

  let updatedCount = 0

  for (const conv of conversations) {
    try {
      const remoteJid = conv.getString('remote_jid')
      const instanceName = conv.getString('instance_name')

      let lastMessages = []
      try {
        lastMessages = $app.findRecordsByFilter(
          'whatsapp_messages',
          'remote_jid = {:jid} && instance_name = {:instance}',
          '-timestamp',
          1,
          0,
          { jid: remoteJid, instance: instanceName },
        )
      } catch (_) {
        continue
      }

      if (!lastMessages || lastMessages.length === 0) continue

      if (lastMessages[0].getBool('from_me')) continue

      let contact
      try {
        contact = $app.findFirstRecordByFilter(
          'crm_contacts',
          'instance_name = {:instance} && jid = {:jid}',
          { instance: instanceName, jid: remoteJid },
        )
      } catch (_) {
        continue
      }

      const currentStage = contact.getString('stage')
      if (currentStage === 'cliente') continue
      if (currentStage === 'nao_respondido') continue

      contact.set('stage', 'nao_respondido')
      $app.save(contact)
      updatedCount++

      // === CARE ALERT: needs_care ===
      if (contact.getBool('is_patient')) {
        try {
          var bId = contact.getString('account_id')
          if (bId) {
            var bSettings = null
            try {
              bSettings = $app.findFirstRecordByFilter(
                'care_alert_settings',
                'account_id = {:aid}',
                { aid: bId },
              )
            } catch (_) {}
            if (
              bSettings &&
              bSettings.getBool('needs_care_alert_enabled') &&
              bSettings.getString('whatsapp_alert_phone')
            ) {
              var bPhone = bSettings.getString('whatsapp_alert_phone').replace(/\D/g, '')
              var bCutoff = new Date(Date.now() - 86400000).toISOString()
              var bDup = false
              try {
                $app.findFirstRecordByFilter(
                  'care_alerts',
                  'crm_contact_id = {:cid} && type = {:t} && created >= {:c}',
                  { cid: contact.id, t: 'needs_care', c: bCutoff },
                )
                bDup = true
              } catch (_) {}
              if (!bDup && bPhone) {
                var bName =
                  contact.getString('contact_name') || contact.getString('push_name') || 'Paciente'
                var bAction =
                  contact.getString('ai_suggested_action') || 'Entrar em contato com a paciente'
                var bMsg =
                  'Dr. Caio, a paciente ' +
                  bName +
                  ' esta sem resposta ha mais de 8 horas. 💛\n\nStatus: Nao respondida\nSugestao: ' +
                  bAction.substring(0, 200)
                var bInst = contact.getString('instance_name')
                var bUrl = $secrets.get('EVOLUTION_API_URL')
                var bKey = $secrets.get('EVOLUTION_API_KEY')
                var bCol = $app.findCollectionByNameOrId('care_alerts')
                var bRec = new Record(bCol)
                bRec.set('account_id', bId)
                bRec.set('type', 'needs_care')
                bRec.set('crm_contact_id', contact.id)
                bRec.set('message', bMsg)
                bRec.set('status', 'pending')
                $app.save(bRec)
                var bStatus = 'failed'
                if (bUrl && bKey && bInst) {
                  var bU = bUrl.endsWith('/') ? bUrl.slice(0, -1) : bUrl
                  try {
                    var bRes = $http.send({
                      url: bU + '/message/sendText/' + bInst,
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json', apikey: bKey },
                      body: JSON.stringify({ number: bPhone, text: bMsg }),
                      timeout: 15,
                    })
                    bStatus = bRes.statusCode === 200 || bRes.statusCode === 201 ? 'sent' : 'failed'
                  } catch (_) {}
                }
                bRec.set('status', bStatus)
                bRec.set('sent_at', new Date().toISOString())
                $app.save(bRec)
              }
            }
          }
        } catch (_) {}
      }
    } catch (err) {
      $app.logger().warn('cron_non_responded_item_error', 'error', String(err))
    }
  }

  if (updatedCount > 0) {
    $app
      .logger()
      .info(
        'cron_non_responded_done',
        'updated',
        updatedCount,
        'total_checked',
        conversations.length,
      )
  }
})
