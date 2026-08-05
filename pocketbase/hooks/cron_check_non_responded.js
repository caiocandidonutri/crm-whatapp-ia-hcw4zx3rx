cronAdd('check_non_responded', '0 * * * *', () => {
  const nowTs = Math.floor(Date.now() / 1000)
  const cutoffTs = nowTs - 24 * 60 * 60

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
