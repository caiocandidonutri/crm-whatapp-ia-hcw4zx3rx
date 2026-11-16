// ============================================================================
// LOOP DO LEAD DE TRÁFEGO PAGO — IA Fabiana
// Detecta lead novo por gatilho de texto nas mensagens recebidas do paciente,
// marca o contato no CRM como "lead de IA ativo" e agenda a resposta da IA
// (~2 min) e os follow-ups a cada 3h, respeitando:
//   - kill-switch global (care_alert_settings.global_automations_paused)
//   - Night Shield 21h–07h (o loop NÃO envia nada nesse intervalo)
//   - janela 00h–04h: sem follow-up (recepcionar ok = só acolhimento inicial)
//   - Fabiana humana 07h–17h: mensagem humana dela desliga a IA do contato
// Este arquivo NÃO envia nada por si só: apenas marca/agenda. O envio é feito
// pelo loop do lead (ia_lead_loop.js) pelo mesmo caminho do cron de IA
// (agent whatsapp-manager + outbox_marks origin 'ia').
// ============================================================================

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

var LEAD_FOLLOWUP_DELIMITERS = /(consulta|acompanhamento|conv[eê]nio|an[uú]ncio)/i

function isPaidTrafficLeadMessage(content) {
  if (!content) return false
  var text = String(content).toLowerCase()
  if (text.length < 8) return false
  if (LEAD_FOLLOWUP_DELIMITERS.test(text) === false) return false
  for (var i = 0; i < LEAD_TRIGGER_PATTERNS.length; i++) {
    if (LEAD_TRIGGER_PATTERNS[i].test(text)) return true
  }
  return false
}

// Hora local de Brasília (UTC-3,sem DST na prática)
function brazilHour() {
  return new Date(Date.now() - 3 * 3600 * 1000).getUTCHours()
}
function isNoFollowupWindow() {
  // (4) Entre 00h e 04h: sem follow-up (recepcionar ok = só acolhimento)
  var h = brazilHour()
  return h >= 0 && h < 4
}
function isNightShieldActive() {
  var h = brazilHour()
  return h >= 21 || h < 7
}
function isFabianaHumanShift() {
  // (5) Fabiana humana atende 07h–17h
  var h = brazilHour()
  return h >= 7 && h < 17
}

function getContactByJid($app, instanceName, remoteJid) {
  try {
    return $app.findFirstRecordByFilter('crm_contacts', 'instance_name = {:inst} && jid = {:jid}', {
      inst: instanceName,
      jid: remoteJid,
    })
  } catch (_) {
    return null
  }
}

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

// Detecção: roda no afterCreate de whatsapp_messages (from_me = false).
// Se a msg casa com gatilho de lead e o contato ainda não está no loop,
// marca o contato: ia_lead_loop = true, ia_lead_stage = 'lead',
// ia_lead_last_trigger_at = agora, e zera follow-up state.
onRecordAfterCreateSuccess(function (e) {
  try {
    var msg = e.record
    if (msg.getBool('from_me')) return e.next()
    var remoteJid = msg.getString('remote_jid')
    if (!remoteJid || remoteJid.indexOf('@g.us') !== -1) return e.next()

    var instanceName = msg.getString('instance_name')
    var accountId = msg.getString('account_id')

    // Já é resposta minha saindo? Nada a fazer.
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
    if (isGlobalAutomationsPaused($app, accountId)) return e.next()

    var contact = getContactByJid($app, instanceName, remoteJid)
    if (!contact) return e.next()

    // Se a Fabiana humana está de plantão (07h–17h), o lead é dela: IA não assume.
    // O loop ainda é marcado, mas com 'human_pending' — se passar de 17h sem
    // resposta humana, o cron assume o follow-up.
    var stage = contact.getString('ia_lead_stage') || ''
    var alreadyInLoop = contact.getBool('ia_lead_loop') || false

    var contactAccountId = contact.getString('account_id') || accountId
    var nowIso = new Date().toISOString()
    var nowTs = Math.floor(Date.now() / 1000)

    var nextStage = 'lead'
    if (isFabianaHumanShift()) nextStage = 'human_pending'
    else if (isNoFollowupWindow()) nextStage = 'lead' // acolhimento ok, follow-up depois

    if (alreadyInLoop && (stage === 'converted' || stage === 'off')) return e.next()

    contact.set('ia_lead_loop', true)
    contact.set('ia_lead_stage', nextStage)
    contact.set('ia_lead_last_trigger_at', nowIso)
    contact.set('ia_lead_last_message_ts', nowTs)
    contact.set('ia_lead_pending_reply', true) // aguardando resposta da IA (~2min)
    contact.set('ia_lead_followup_count', 0)
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

// Desligar a IA do contato na hora: mensagem humana da Fabiana
// (origin humano_celular / humano_crm) sobre um contato que está no loop.
onRecordAfterCreateSuccess(function (e) {
  try {
    var msg = e.record
    if (!msg.getBool('from_me')) return e.next()
    var origin = msg.getString('origin') || ''
    if (origin !== 'humano_celular' && origin !== 'humano_crm') return e.next()
    var remoteJid = msg.getString('remote_jid')
    if (!remoteJid || remoteJid.indexOf('@g.us') !== -1) return e.next()

    var contact = getContactByJid($app, msg.getString('instance_name'), remoteJid)
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

module.exports = {
  isPaidTrafficLeadMessage: isPaidTrafficLeadMessage,
  isNoFollowupWindow: isNoFollowupWindow,
  isNightShieldActive: isNightShieldActive,
  isFabianaHumanShift: isFabianaHumanShift,
}
