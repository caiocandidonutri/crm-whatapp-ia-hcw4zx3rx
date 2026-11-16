// ============================================================================
// LOOP DO LEAD DE TRÁFEGO PAGO — IA Fabiana (DETECÇÃO + HUMANA ASSUME)
// Roda no afterCreate de whatsapp_messages (webhook).
//   (1) Detecta lead novo por gatilho de texto ('vi seu anúncio', etc.).
//   (5) Mensagem humana da Fabiana (humano_celular/humano_crm) desliga a IA
//       daquele contato NA HORA.
// Este arquivo NÃO envia nada: só marca/agenda. O envio é feito pelo cron
// (ia_lead_loop_cron.js) — resposta ~2min, follow-up a cada 3h.
// IMPORTANTE (JSVM do PocketBase): TODA função/constante vive DENTRO de cada
// callback — nada no topo do arquivo (hook scoping error).
// ZERO deletes. Kill-switch global respeitado.
// ============================================================================

onRecordAfterCreateSuccess(function (e) {
  try {
    var LEAD_TRIGGER_PATTERNS = [
      /vi\s+(seu|sua)\s+an[uú]ncio/i,
      /an[uú]ncio\s+(no|na|do|da)\s+(instagram|facebook|google)/i,
      /vi\s+(no|na)\s+(instagram|facebook|google)/i,
      /quero\s+informa[cç][oõ]es/i,
      /gostaria\s+de\s+informa[cç][oõ]es/i,
      /quero\s+saber\s+(sobre|mais)/i,
      /informa[cç][oõ]es\s+sobre\s+(atendimento|consulta)/i,
      /como\s+funciona\s+(o\s+)?(atendimento|consulta)/i,
      /quero\s+(marcar|agendar)\s+(uma\s+)?(consulta|acompanhamento|avalia[cç][aã]o)/i,
      /quero\s+(marcar|agendar)\s+.*(consulta|acompanhamento|avalia)/i,
      /valor\s+(da\s+)?(consulta|sess[aã]o|acompanhamento)/i,
      /quanto\s+(custa|fica)\s+(a\s+)?(consulta|sess[aã]o|acompanhamento)/i,
      /aceita\s+(conv[eê]nio|plano\s+de\s+sa[uú]de)/i,
      /(faz|trabalha)\s+com\s+conv[eê]nio/i,
      /atende\s+(por\s+)?conv[eê]nio/i,
      /(primeira|1[ªa])\s+(consulta|sess[aã]o|avalia[cç][aã]o)/i,
    ]
    var LEAD_TOPIC_DELIMITERS = /(consulta|acompanhamento|conv[eê]nio|an[uú]ncio|atendimento)/i

    var isPaidTrafficLeadMessage = function (content) {
      if (!content) return false
      var text = String(content).toLowerCase()
      if (text.length < 8) return false
      if (!LEAD_TOPIC_DELIMITERS.test(text)) return false
      for (var p = 0; p < LEAD_TRIGGER_PATTERNS.length; p++) {
        if (LEAD_TRIGGER_PATTERNS[p].test(text)) return true
      }
      return false
    }

    // Hora local de Brasília (UTC-3, sem DST na prática)
    var brazilHour = function () {
      return new Date(Date.now() - 3 * 3600 * 1000).getUTCHours()
    }
    var isFabianaHumanShift = function () {
      // (5) Fabiana humana atende 07h–17h
      return brazilHour() >= 7 && brazilHour() < 17
    }

    var getContactByJid = function (instanceName, remoteJid) {
      try {
        return $app.findFirstRecordByFilter(
          'crm_contacts',
          'instance_name = {:inst} && jid = {:jid}',
          { inst: instanceName, jid: remoteJid },
        )
      } catch (_) {
        return null
      }
    }

    var isGlobalAutomationsPaused = function (accountId) {
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

    var msg = e.record
    if (msg.getBool('from_me')) return e.next()
    var remoteJid = msg.getString('remote_jid')
    if (!remoteJid || remoteJid.indexOf('@g.us') !== -1) return e.next()

    var instanceName = msg.getString('instance_name')
    var accountId = msg.getString('account_id')

    var content = msg.getString('content') || ''
    var transcription = msg.getString('transcription') || ''
    if (
      (!content || content.indexOf('[audio') === 0 || content.indexOf('[Áudio') === 0) &&
      transcription &&
      transcription !== 'SKIP_NO_TRANSCRIBE'
    ) {
      content = transcription
    }
    if (!isPaidTrafficLeadMessage(content)) return e.next()

    // Kill-switch global: NÃO iniciar loop (nem agendar nada)
    if (isGlobalAutomationsPaused(accountId)) return e.next()

    var contact = getContactByJid(instanceName, remoteJid)
    if (!contact) return e.next()

    var stage = contact.getString('ia_lead_stage') || ''
    var alreadyInLoop = contact.getBool('ia_lead_loop') || false

    // Contato já convertido ou desligado manualmente: não reativa sozinho.
    if (alreadyInLoop && (stage === 'converted' || stage === 'off')) return e.next()

    var nowIso = new Date().toISOString()
    var nowTs = Math.floor(Date.now() / 1000)

    // Fabiana humana de plantão (07h–17h): o lead é dela primeiro — o loop
    // fica 'human_pending' e a IA só assume se ninguém responder até 17h
    // (ou se o lead chegar fora do plantão).
    var nextStage = 'lead'
    if (isFabianaHumanShift()) nextStage = 'human_pending'

    contact.set('ia_lead_loop', true)
    contact.set('ia_lead_stage', nextStage)
    contact.set('ia_lead_last_trigger_at', nowIso)
    contact.set('ia_lead_last_message_ts', nowTs)
    contact.set('ia_lead_pending_reply', true) // aguardando resposta da IA (~2min)
    contact.set('ia_lead_followup_count', 0)
    contact.set('ia_lead_retry_count', 0)
    contact.set('ia_lead_source', 'trafego_pago')
    try {
      $app.saveNoValidate(contact)
    } catch (saveErr) {
      $app.logger().warn('ia_lead_loop: save contact error', 'err', String(saveErr))
      return e.next()
    }

    $app.logger().info('ia_lead_loop: lead detectado', 'jid', remoteJid, 'stage', nextStage)
  } catch (hookErr) {
    $app.logger().error('ia_lead_loop: hook error', 'err', String(hookErr))
  }
  return e.next()
}, 'whatsapp_messages')

// (5) HUMANA ASSUME: mensagem humana da Fabiana sobre um contato no loop
// desliga a IA daquele contato NA HORA.
onRecordAfterCreateSuccess(function (e) {
  try {
    var isMessageActuallyHuman = function (msg) {
      // A msg de saída da própria IA chega pelo webhook com origin provisória
      // 'humano_celular' (reclassificada depois pelo outbox_marks). Antes de
      // tratar uma msg from_me como HUMANA, checa a marca: se saiu da
      // IA/automação, NÃO é humana.
      try {
        var markRec = $app.findFirstRecordByFilter('outbox_marks', 'message_id = {:mid}', {
          mid: msg.getString('message_id') || '',
        })
        if (markRec) {
          var mOrg = markRec.getString('origin') || ''
          if (mOrg === 'ia' || mOrg === 'automacao') return false
        }
      } catch (_) {}
      return true
    }

    var getContactByJid = function (instanceName, remoteJid) {
      try {
        return $app.findFirstRecordByFilter(
          'crm_contacts',
          'instance_name = {:inst} && jid = {:jid}',
          { inst: instanceName, jid: remoteJid },
        )
      } catch (_) {
        return null
      }
    }

    var msg = e.record
    if (!msg.getBool('from_me')) return e.next()
    var origin = msg.getString('origin') || ''
    if (origin !== 'humano_celular' && origin !== 'humano_crm') return e.next()
    var remoteJid = msg.getString('remote_jid')
    if (!remoteJid || remoteJid.indexOf('@g.us') !== -1) return e.next()

    // Guard: msg da própria IA/automação (outbox mark) não é humana.
    if (!isMessageActuallyHuman(msg)) return e.next()

    var contact = getContactByJid(msg.getString('instance_name'), remoteJid)
    if (!contact) return e.next()
    if (!contact.getBool('ia_lead_loop')) return e.next()

    var stage = contact.getString('ia_lead_stage') || ''
    if (stage === 'converted' || stage === 'off') return e.next()

    contact.set('ia_lead_stage', 'off')
    contact.set('ia_lead_pending_reply', false)
    contact.set('ia_lead_disabled_at', new Date().toISOString())
    contact.set('ia_lead_disabled_by', 'humano_' + origin)
    $app.saveNoValidate(contact)
    $app.logger().info('ia_lead_loop: IA desligada por humano', 'jid', remoteJid)
  } catch (err) {
    $app.logger().error('ia_lead_loop: disable hook error', 'err', String(err))
  }
  return e.next()
}, 'whatsapp_messages')
