// ============================================================================
// LOOP DO LEAD — CRON DE EXECUÇÃO (a cada 5 min)
//   1. Resposta da IA ao lead novo ~2 min após o gatilho (ia_lead_pending_reply).
//   2. Follow-up a cada 3h se o lead não respondeu.
//   3. Nunca envia entre 00h–04h (sem follow-up) nem no Night Shield 21h–07h.
//   4. Fabiana humana de plantão (07h–17h): IA não assume lead novo; follow-up
//      do lead que chegou fora do plantão roda normalmente.
//   5. Kill-switch global respeitado em TODOS os envios.
// Envio pelo mesmo caminho do cron de IA: $ai.agent('whatsapp-manager') →
// Evolution sendText → outbox_marks origin 'ia' → msg local from_me 'Assistente'.
// Créditos OpenAI esgotados: $ai.agent lança erro → degrada sem quebrar
// (máx. 3 tentativas, depois contato sai do 'pending' e é reavaliado depois).
// ============================================================================

var leadLoop = require(`${__hooks}/ia_lead_loop.js`)

function isGlobalAutomationsPaused($app, accountId) {
  try {
    var filter = 'global_automations_paused = true'
    if (accountId) {
      filter = 'account_id = "' + accountId + '" && global_automations_paused = true'
    }
    $app.findFirstRecordByFilter('care_alert_settings', filter)
    return true
  } catch (_) {
    return false
  }
}

// =====================================================================
// PROMPT DA FABIANA PARA LEAD DE TRÁFEGO PAGO
// =====================================================================
function buildFabianaLeadPrompt($app, contact, msg, mode) {
  var contactName =
    contact.getString('contact_name') || contact.getString('push_name') || 'Paciente'
  var contactPhone = (contact.getString('jid') || '').replace('@s.whatsapp.net', '')
  var stage = contact.getString('ia_lead_stage') || ''

  var recentMsgs = []
  try {
    recentMsgs = $app.findRecordsByFilter(
      'whatsapp_messages',
      'remote_jid = {:jid} && instance_name = {:inst}',
      '-timestamp',
      10,
      0,
      { jid: contact.getString('jid'), inst: contact.getString('instance_name') },
    )
  } catch (_) {}

  var historyLines = []
  for (var i = recentMsgs.length - 1; i >= 0; i--) {
    var m = recentMsgs[i]
    var c = m.getString('content') || ''
    if (!c) continue
    historyLines.push(
      '- ' + (m.getBool('from_me') ? 'Clínica (Fabiana)' : 'Lead (' + contactName + ')') + ': ' + c,
    )
  }
  var historyBlock = historyLines.length
    ? '\n\n[HISTÓRICO RECENTE DA CONVERSA]\n' + historyLines.join('\n') + '\n[FIM]'
    : ''

  var isFollowup = mode === 'followup'
  var followupCount = contact.getInt('ia_lead_followup_count') || 0

  var goal = ''
  if (isFollowup) {
    goal =
      'MODO: FOLLOW-UP AUTOMÁTICO (lead não respondeu há ~3h). Envie uma mensagem CURTA, ' +
      'leve e sem cobrança — reabra a conversa com empatia e ofereça ajuda concreta. ' +
      'Este é o follow-up nº ' +
      (followupCount + 1) +
      '. Varie o texto em relação às mensagens anteriores (não repita a mesma frase).'
  } else {
    goal =
      'MODO: PRIMEIRA RESPOSTA AO LEAD (veio de anúncio de tráfego pago). Acolha com ' +
      'calidez, agradeça o contato e pergunte com naturalidade qual é a necessidade ' +
      '(consulta, acompanhamento, convênio, dúvida).'
  }

  var systemPrompt =
    'Você é a Fabiana, secretária da clínica de nutrição do Dr. Caio. Responda como ela.\n' +
    '\n[DIRETRIZES — LEAD DE TRÁFEGO PAGO]\n' +
    '- ' +
    goal +
    '\n' +
    '- CONVÊNIO: a clínica atende SÓ particular. Se o lead perguntar de convênio/plano,\n' +
    '  use o argumento de valor: atendimento humanizado, tempo de consulta estendido,\n' +
    '  plano alimentar individualizado e acompanhamento próximo — sem fila de espera.\n' +
    '- NÃO invente horários, preços fechados ou disponibilidade de agenda.\n' +
    '- Se o lead pedir agendamento, diga que vai confirmar os horários com o Dr. Caio e já retorna.\n' +
    '- Uma mensagem = um assunto. Tom humano, breve, sem texto corrido longo.\n' +
    '- NUNCA revele que é IA.\n' +
    '\n[CONTEXTO DO CONTATO]\nNome: ' +
    contactName +
    '\nTelefone: ' +
    contactPhone +
    '\nEstágio no CRM: ' +
    stage

  var textContent = msg ? msg.getString('content') || '' : ''
  var transcription = msg ? msg.getString('transcription') || '' : ''
  if (
    (!textContent || textContent.indexOf('[audio') === 0 || textContent.indexOf('[Áudio') === 0) &&
    transcription &&
    transcription !== 'SKIP_NO_TRANSCRIBE'
  ) {
    textContent = '[Áudio transcrito]: ' + transcription
  }
  if (!textContent) textContent = 'Mensagem em formato de mídia.'

  return (
    systemPrompt +
    historyBlock +
    '\n\n[ÚLTIMA MENSAGEM DO LEAD]:\n' +
    (isFollowup ? '(lead ficou em silêncio desde a última mensagem da clínica)' : textContent)
  )
}

// =====================================================================
// ENVIA via Evolution + outbox_marks origin 'ia' + msg local
// =====================================================================
function sendIaMessage($app, contact, text) {
  var apiUrlRaw = $secrets.get('EVOLUTION_API_URL') || ''
  var apiUrl = apiUrlRaw.endsWith('/') ? apiUrlRaw.slice(0, -1) : apiUrlRaw
  var evApiKey = $secrets.get('EVOLUTION_API_KEY') || ''
  if (!apiUrl || !evApiKey) {
    $app.logger().error('ia_lead_loop: Evolution credentials missing')
    return null
  }

  var remoteJid = contact.getString('jid')
  var instanceName = contact.getString('instance_name')
  var evolutionNumber = remoteJid.split('@')[0]
  var accountId = contact.getString('account_id')
  var nowTs = Math.floor(Date.now() / 1000)

  var sendRes = $http.send({
    url: apiUrl + '/message/sendText/' + instanceName,
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: evApiKey },
    body: JSON.stringify({ number: evolutionNumber, text: text }),
    timeout: 6,
  })

  if (sendRes.statusCode < 200 || sendRes.statusCode >= 300) {
    $app.logger().error('ia_lead_loop: Evolution sendText failed', 'status', sendRes.statusCode)
    return null
  }

  var sentMsgId = ''
  try {
    sentMsgId = sendRes.json && sendRes.json.key && sendRes.json.key.id
  } catch (_) {}
  if (!sentMsgId) sentMsgId = 'ia_lead_' + $security.randomString(16)

  // outbox_marks origin 'ia' (mesmo helper do cron de IA existente)
  try {
    var outboxMarksHelper = require(`${__hooks}/outbox_marks_helper.js`)
    outboxMarksHelper.recordOutboxMark($app, sentMsgId, 'ia')
  } catch (markErr) {
    $app.logger().warn('ia_lead_loop: outbox mark error', 'err', String(markErr))
  }

  var msgCol = $app.findCollectionByNameOrId('whatsapp_messages')
  var newMsg = new Record(msgCol)
  newMsg.set('user_id', contact.getString('user_id'))
  if (accountId) newMsg.set('account_id', accountId)
  newMsg.set('instance_name', instanceName)
  newMsg.set('remote_jid', remoteJid)
  newMsg.set('from_me', true)
  newMsg.set('origin', 'ia')
  newMsg.set('message_id', sentMsgId)
  newMsg.set('push_name', 'Assistente')
  newMsg.set('content', text)
  newMsg.set('message_type', 'conversation')
  newMsg.set('status', 'pending')
  newMsg.set('timestamp', nowTs)
  $app.save(newMsg)

  try {
    var conv = $app.findFirstRecordByFilter(
      'conversations',
      'remote_jid = {:jid} && instance_name = {:instance}',
      { jid: remoteJid, instance: instanceName },
    )
    if (conv) {
      conv.set('last_message', text)
      conv.set('last_message_timestamp', nowTs)
      conv.set('unread_count', 0)
      $app.save(conv)
    }
  } catch (_) {}

  return sentMsgId
}

// =====================================================================
// CHAMA A IA (agent whatsapp-manager) — degrada graciosamente se falhar
// =====================================================================
function callFabianaAi($app, contact, msg, mode, errorPrefix) {
  var userId = contact.getString('user_id')
  var prompt = buildFabianaLeadPrompt($app, contact, msg, mode)

  var aiConvId = ''
  try {
    var agentConv = $ai.agent('whatsapp-manager').getOrCreateConversation({
      user_id: userId,
      id: null,
      title: 'Lead tráfego pago: ' + (contact.getString('jid') || ''),
    })
    if (agentConv && agentConv.id) aiConvId = agentConv.id
  } catch (_) {}

  try {
    return $ai.agent('whatsapp-manager').chat({
      user_id: userId,
      conversation_id: aiConvId || null,
      message: prompt,
    })
  } catch (aiErr) {
    $app.logger().error(errorPrefix, 'err', String(aiErr))
    return null
  }
}

// =====================================================================
// PASSO 1: responder o lead em ~2 min
// =====================================================================
function processPendingReply($app, contact, nowTs) {
  var remoteJid = contact.getString('jid')
  var instanceName = contact.getString('instance_name')
  var triggerTs = contact.getInt('ia_lead_last_message_ts') || 0

  // Resposta da IA: ~2 min após o gatilho
  if (nowTs - triggerTs < 110) return

  var triggerMsg = null
  try {
    var recents = $app.findRecordsByFilter(
      'whatsapp_messages',
      'remote_jid = {:jid} && instance_name = {:inst} && from_me = false',
      '-timestamp',
      1,
      0,
      { jid: remoteJid, inst: instanceName },
    )
    if (recents && recents.length > 0) triggerMsg = recents[0]
  } catch (_) {}

  // Já houve msg minha (humana ou IA) depois do gatilho? Loop já foi atendido.
  try {
    var laterMine = $app.findRecordsByFilter(
      'whatsapp_messages',
      'remote_jid = {:jid} && instance_name = {:inst} && from_me = true && timestamp > {:ts}',
      '-timestamp',
      1,
      0,
      { jid: remoteJid, inst: instanceName, ts: triggerTs },
    )
    if (laterMine && laterMine.length > 0) {
      contact.set('ia_lead_pending_reply', false)
      contact.set('ia_lead_stage', 'engaged')
      $app.saveNoValidate(contact)
      return
    }
  } catch (_) {}

  var result = callFabianaAi($app, contact, triggerMsg, 'first', 'ia_lead_loop: AI chat failed')
  if (!result) {
    // Degradação graciosa: tenta de novo no próximo tick, máx. 3 tentativas.
    var tries = (contact.getInt('ia_lead_retry_count') || 0) + 1
    contact.set('ia_lead_retry_count', tries)
    if (tries >= 3) {
      contact.set('ia_lead_pending_reply', false)
      contact.set('ia_lead_stage', 'engaged')
    }
    $app.saveNoValidate(contact)
    return
  }

  var replyText = result && result.content ? result.content.trim() : ''
  if (!replyText) {
    contact.set('ia_lead_pending_reply', false)
    $app.saveNoValidate(contact)
    return
  }

  var sentId = sendIaMessage($app, contact, replyText)
  if (!sentId) return // falhou o envio → tenta no próximo tick

  contact.set('ia_lead_pending_reply', false)
  contact.set('ia_lead_stage', 'engaged')
  contact.set('ia_lead_retry_count', 0)
  contact.set('ia_lead_last_ai_reply_at', new Date().toISOString())
  $app.saveNoValidate(contact)
}

// =====================================================================
// PASSO 2: follow-up a cada 3h se o lead não respondeu
// =====================================================================
function processFollowup($app, contact, nowTs) {
  var remoteJid = contact.getString('jid')
  var instanceName = contact.getString('instance_name')

  var lastInboundTs = 0
  try {
    var recents = $app.findRecordsByFilter(
      'whatsapp_messages',
      'remote_jid = {:jid} && instance_name = {:inst} && from_me = false',
      '-timestamp',
      1,
      0,
      { jid: remoteJid, inst: instanceName },
    )
    if (recents && recents.length > 0) lastInboundTs = recents[0].getInt('timestamp') || 0
  } catch (_) {}

  var lastAiReplyTs = 0
  try {
    var lastAi = $app.findRecordsByFilter(
      'whatsapp_messages',
      'remote_jid = {:jid} && instance_name = {:inst} && from_me = true && origin = {:org}',
      '-timestamp',
      1,
      0,
      { jid: remoteJid, inst: instanceName, org: 'ia' },
    )
    if (lastAi && lastAi.length > 0) lastAiReplyTs = lastAi[0].getInt('timestamp') || 0
  } catch (_) {}

  // Fabiana humana respondeu depois da última msg recebida? Contato é dela.
  var humanAfter = false
  try {
    var h1 = $app.findRecordsByFilter(
      'whatsapp_messages',
      'remote_jid = {:jid} && instance_name = {:inst} && from_me = true && timestamp > {:ts} && origin = {:o}',
      '-timestamp',
      1,
      0,
      { jid: remoteJid, inst: instanceName, ts: lastInboundTs, o: 'humano_celular' },
    )
    if (h1 && h1.length > 0) humanAfter = true
  } catch (_) {}
  if (!humanAfter) {
    try {
      var h2 = $app.findRecordsByFilter(
        'whatsapp_messages',
        'remote_jid = {:jid} && instance_name = {:inst} && from_me = true && timestamp > {:ts} && origin = {:o}',
        '-timestamp',
        1,
        0,
        { jid: remoteJid, inst: instanceName, ts: lastInboundTs, o: 'humano_crm' },
      )
      if (h2 && h2.length > 0) humanAfter = true
    } catch (_) {}
  }
  if (humanAfter) {
    contact.set('ia_lead_stage', 'off')
    contact.set('ia_lead_pending_reply', false)
    contact.set('ia_lead_disabled_by', 'humano_followup')
    $app.saveNoValidate(contact)
    return
  }

  // Lead engajou (respondeu depois da última resposta da IA)? Aguarda humano/IA.
  if (lastInboundTs > 0 && lastInboundTs > lastAiReplyTs) return

  var lastClinicTs = Math.max(lastInboundTs, lastAiReplyTs)
  if (lastClinicTs === 0) return
  if (nowTs - lastClinicTs < 3 * 3600) return // ainda não deu 3h

  var result = callFabianaAi($app, contact, null, 'followup', 'ia_lead_loop: followup AI failed')
  if (!result) return // tenta no próximo tick

  var replyText = result && result.content ? result.content.trim() : ''
  if (!replyText) return

  var sentId = sendIaMessage($app, contact, replyText)
  if (!sentId) return

  contact.set('ia_lead_followup_count', (contact.getInt('ia_lead_followup_count') || 0) + 1)
  contact.set('ia_lead_last_followup_at', new Date().toISOString())
  $app.saveNoValidate(contact)
}

// =====================================================================
// CRON PRINCIPAL — a cada 5 min
// =====================================================================
cronAdd('ia_lead_loop_cron', '*/5 * * * *', function () {
  var processContacts = function (filter, handler) {
    var contacts = []
    try {
      contacts = $app.findRecordsByFilter('crm_contacts', filter, '-updated', 20, 0)
    } catch (_) {
      return
    }
    if (!contacts || contacts.length === 0) return
    var nowTs = Math.floor(Date.now() / 1000)
    for (var i = 0; i < contacts.length; i++) {
      var contact = contacts[i]
      try {
        var stage = contact.getString('ia_lead_stage') || ''
        if (stage === 'off' || stage === 'converted') continue
        if (isGlobalAutomationsPaused($app, contact.getString('account_id'))) continue

        // Fabiana humana de plantão (07h–17h): IA NÃO assume lead novo.
        var isHumanShift = leadLoop.isFabianaHumanShift()
        if (isHumanShift && stage === 'human_pending') continue

        handler(contact, nowTs)
      } catch (err) {
        $app.logger().error('ia_lead_loop_cron: contact error', 'err', String(err))
      }
    }
  }

  try {
    if (leadLoop.isNightShieldActive()) return // 21h–07h: nada é enviado

    if (leadLoop.isNoFollowupWindow()) {
      // 00h–04h: SEM follow-up. Só acolhimento (resposta ~2min) é permitido.
      processContacts('ia_lead_pending_reply = true', function (contact, nowTs) {
        processPendingReply($app, contact, nowTs)
      })
      return
    }

    processContacts('ia_lead_loop = true', function (contact, nowTs) {
      if (contact.getBool('ia_lead_pending_reply')) {
        processPendingReply($app, contact, nowTs)
      } else {
        processFollowup($app, contact, nowTs)
      }
    })
  } catch (fatalErr) {
    $app.logger().error('ia_lead_loop_cron fatal', 'err', String(fatalErr))
  }
})
