onRecordAfterCreateSuccess((e) => {
  try {
    const msg = e.record
    if (msg.getBool('from_me')) return e.next()

    const remoteJid = msg.getString('remote_jid')
    if (remoteJid.endsWith('@g.us')) return e.next()

    let conv
    try {
      conv = $app.findFirstRecordByFilter(
        'conversations',
        'remote_jid = {:jid} && instance_name = {:instance}',
        { jid: remoteJid, instance: msg.getString('instance_name') },
      )
    } catch (_) {
      return e.next()
    }

    // KILL SWITCH GLOBAL: se automações pausadas, NUNCA disparar resposta de IA
    var accountId = conv.getString('account_id')
    try {
      var kFilter = 'global_automations_paused = true'
      if (accountId) {
        kFilter = 'account_id = "' + accountId + '" && global_automations_paused = true'
      }
      var kPaused = $app.findFirstRecordByFilter('care_alert_settings', kFilter)
      if (kPaused) {
        $app
          .logger()
          .info(
            'Envio cancelado: automações globais pausadas',
            'hook',
            'whatsapp_ai_response',
            'msg_id',
            msg.id,
          )
        return e.next()
      }
    } catch (_) {}

    if (!conv.getBool('ai_enabled')) return e.next()

    const agentId = conv.getString('ai_agent_id')
    if (!agentId) return e.next()

    let latestMsg
    try {
      latestMsg = $app.findRecordById('whatsapp_messages', msg.id)
    } catch (_) {
      return e.next()
    }

    if (!latestMsg.getBool('pending_ai_response')) return e.next()

    try {
      $app.findRecordById('ai_agents', agentId)
    } catch (_) {
      latestMsg.set('pending_ai_response', false)
      $app.saveNoValidate(latestMsg)
      return e.next()
    }

    var now = new Date()
    var brazilMs = now.getTime() - 3 * 60 * 60 * 1000
    var brazilTime = new Date(brazilMs)
    var dayOfWeek = brazilTime.getUTCDay()
    var hour = brazilTime.getUTCHours()
    var isWeekend = dayOfWeek === 0 || dayOfWeek === 6

    var isBusinessHours = !isWeekend && ((hour >= 7 && hour < 11) || (hour >= 13 && hour < 19))

    if (isBusinessHours) {
      latestMsg.set('pending_ai_response', false)
      $app.saveNoValidate(latestMsg)
      return e.next()
    }

    latestMsg.set('ai_response_attempted_at', new Date().toISOString())
    $app.saveNoValidate(latestMsg)
  } catch (err) {
    $app.logger().error('ai_response_hook_error', 'error', String(err))
  }

  return e.next()
}, 'whatsapp_messages')
