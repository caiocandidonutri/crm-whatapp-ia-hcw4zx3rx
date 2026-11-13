// pocketbase/hooks/cron_outbox_reclassify.js
// Cron 1 min: reclassifica mensagens from_me criadas nos últimos 5 minutos que
// ficaram com origin "humano_celular" provisório no webhook.
// Se o message_id aparece em outbox_marks, corrige a origin para a marca e
// recalcula o care_state do contato usando o care_state_engine (função única
// compartilhada — sem duplicar lógica).
// NÃO envia nada (não precisa de kill-switch/Night Shield), timeouts curtos.

cronAdd('cron_outbox_reclassify', '* * * * *', () => {
  const startTime = Date.now()
  const maxExecutionMs = 5000 // budget defensivo 5s (dentro da janela 3-6s)

  try {
    const fiveMinAgoIso = new Date(Date.now() - 5 * 60 * 1000).toISOString()

    // Mensagens from_me recentes ainda classificadas como humano_celular
    let candidates = []
    try {
      candidates = $app.findRecordsByFilter(
        'whatsapp_messages',
        "from_me = true && origin = 'humano_celular' && created >= {:since}",
        '-created',
        200,
        0,
        { since: fiveMinAgoIso },
      )
    } catch (_) {}

    if (!candidates || candidates.length === 0) return

    const careEngine = require(`${__hooks}/care_state_engine.js`)
    let reclassified = 0

    for (let i = 0; i < candidates.length; i++) {
      if (Date.now() - startTime > maxExecutionMs) {
        $app.logger().info('cron_outbox_reclassify: timeout budget reached', 'processed', i)
        break
      }

      const msg = candidates[i]
      const messageId = msg.getString('message_id')
      if (!messageId) continue

      let markOrigin = ''
      try {
        const markRec = $app.findFirstRecordByFilter('outbox_marks', 'message_id = {:mid}', {
          mid: messageId,
        })
        if (markRec) {
          markOrigin = markRec.getString('origin')
        }
      } catch (_) {}

      if (markOrigin !== 'ia' && markOrigin !== 'automacao') continue

      // Corrige a origin conforme a marca
      msg.set('origin', markOrigin)
      try {
        $app.saveNoValidate(msg)
        reclassified++
      } catch (saveErr) {
        $app
          .logger()
          .warn('cron_outbox_reclassify: save failed', 'mid', messageId, 'err', String(saveErr))
        continue
      }

      // Recalcula o care_state do contato pela função única do care_state_engine
      const jid = msg.getString('remote_jid')
      if (!jid) continue
      let contact = null
      try {
        contact = $app.findFirstRecordByFilter('crm_contacts', 'jid = {:jid}', { jid: jid })
      } catch (_) {}
      if (!contact) continue

      try {
        careEngine.reconcileAndSaveContactCareState(contact, { nowMs: Date.now() })
      } catch (recErr) {
        $app
          .logger()
          .warn(
            'cron_outbox_reclassify: care_state reconcile failed',
            'jid',
            jid,
            'err',
            String(recErr),
          )
      }
    }

    if (reclassified > 0) {
      $app
        .logger()
        .info(
          'cron_outbox_reclassify: finished',
          'reclassified',
          reclassified,
          'durationMs',
          Date.now() - startTime,
        )
    }
  } catch (globalErr) {
    $app.logger().error('cron_outbox_reclassify: fatal error', 'err', String(globalErr))
  }
})
