/// <reference path="../pb_data/types.d.ts" />

/**
 * CRON MENTOR EXPORT — Exportação diária anonimizada para o Maestro (Mentor).
 * Executa 1x ao dia às 12:03 UTC (09:03 Brasília).
 *
 * Autorização: Dr. Caio Cândido (05/10/2026) — base do ALERTA DIÁRIO,
 * relatório de vazamentos e "Manual da Fabiana" (transição 90 dias).
 *
 * LGPD ESTRITA (salvaguarda do Dr. Caio, 05/10):
 * - Contatos: apenas iniciais do nome + últimos 4 dígitos do telefone.
 * - Mensagens: NENHUM texto sai do CRM (nem da equipe). Apenas padrões
 *   agregados: histograma de dia da semana/hora, tipos de mensagem e
 *   faixa de tamanho médio.
 * - Nunca envia: CPF, endereço, dados clínicos, textos de conversas.
 * - Histórico: v0.0.143 enviava conteúdo das mensagens da equipe;
 *   REMOVIDO nesta versão por ordem do Dr. Caio (salvaguarda 2).
 *
 * Respeita o kill-switch global (care_alert_settings.global_automations_paused).
 */

cronAdd('cron_mentor_export', '3 12 * * *', () => {
  try {
    // KILL SWITCH GLOBAL — primeira instrução: se qualquer registro de
    // care_alert_settings estiver com global_automations_paused = true,
    // a exportação NÃO roda (mesma trava dos demais crons do sistema).
    try {
      var pausedRec = $app.findFirstRecordByFilter(
        'care_alert_settings',
        'global_automations_paused = true',
      )
      if (pausedRec) {
        $app.logger().info('cron_mentor_export: skipped (automations paused)')
        return
      }
    } catch (_) {}

    var WEBHOOK_URL =
      'https://maestro.adapta.one/webhooks/generic/e7d91885cd5ab622517a1440271160be4a65aaed67c5769b4d7898685ca7f31c?secret=22599790806c950800e685dc851a4897c050b0af17e933f0c03e64b1e9c71d4a'

    function initials(name) {
      if (!name) return 'N.N.'
      var parts = String(name).trim().split(/\s+/)
      var out = ''
      for (var i = 0; i < parts.length && i < 2; i++) {
        if (parts[i].length > 0) out += parts[i].charAt(0).toUpperCase()
      }
      return out || 'N.N.'
    }

    function maskPhone(val) {
      var digits = String(val || '').replace(/\D/g, '')
      if (digits.length < 4) return ''
      return '*****' + digits.slice(-4)
    }

    function maskJid(jid) {
      var m = String(jid || '').match(/^(\d+)@/)
      if (!m) return ''
      return maskPhone(m[1])
    }

    function safeIso(rec, field) {
      try {
        var v = rec.getString(field)
        return v || ''
      } catch (_) {
        return ''
      }
    }

    // ── 1. CONTATOS (anonimizados) ──────────────────────────────────────
    var contactsOut = []
    try {
      var contacts = $app.findRecordsByFilter('crm_contacts', 'id != ""', '-updated', 1000, 0)
      for (var i = 0; i < contacts.length; i++) {
        var c = contacts[i]
        var name = c.getString('contact_name') || c.getString('push_name') || ''
        var phone = maskPhone(c.getString('phone') || '')
        if (!phone) phone = maskJid(c.getString('jid') || '')
        var suggested = c.getString('ai_suggested_action') || ''
        if (suggested.length > 120) suggested = suggested.substring(0, 120)
        contactsOut.push({
          key: initials(name) + '-' + phone,
          stage: c.getString('stage') || '',
          role: c.getString('role') || '',
          is_patient: c.getBool('is_patient'),
          care_status: c.getString('care_status') || '',
          ai_priority: c.getNumber('ai_priority') || 0,
          created: safeIso(c, 'created'),
          updated: safeIso(c, 'updated'),
          converted_at: safeIso(c, 'converted_at'),
          last_recall_sent_at: safeIso(c, 'last_recall_sent_at'),
          recall_count: c.getNumber('recall_count') || 0,
          ai_suggested_action: suggested,
        })
      }
    } catch (errC) {
      $app.logger().warn('cron_mentor_export: contacts failed', 'error', String(errC))
    }

    // ── 2. AGENDAMENTOS (paciente referenciado por chave anonimizada) ───
    var apptsOut = []
    try {
      var appts = $app.findRecordsByFilter('appointments', 'id != ""', '-starts_at', 500, 0)
      for (var a = 0; a < appts.length; a++) {
        var ap = appts[a]
        var pKey = ''
        try {
          var pRec = $app.findRecordById('crm_contacts', ap.getString('patient_id'))
          var pName = pRec.getString('contact_name') || pRec.getString('push_name') || ''
          var pPhone = maskPhone(pRec.getString('phone') || '')
          if (!pPhone) pPhone = maskJid(pRec.getString('jid') || '')
          pKey = initials(pName) + '-' + pPhone
        } catch (_) {}
        apptsOut.push({
          id: ap.id,
          patient_key: pKey,
          starts_at: safeIso(ap, 'starts_at'),
          status: ap.getString('status') || '',
        })
      }
    } catch (errA) {
      $app.logger().warn('cron_mentor_export: appointments failed', 'error', String(errA))
    }

    // ── 3. PADRÕES AGREGADOS DAS MENSAGENS (LGPD ESTRITA: nenhum texto sai) ──
    var msgAgg = {
      total: 0,
      by_weekday: [0, 0, 0, 0, 0, 0, 0],
      by_hour: {},
      by_type: {},
      avg_length_bucket: '',
    }
    try {
      var msgs = $app.findRecordsByFilter(
        'whatsapp_messages',
        'from_me = true',
        '-timestamp',
        500,
        0,
      )
      var sumLen = 0
      for (var m = 0; m < msgs.length; m++) {
        var msg = msgs[m]
        var ts = msg.getNumber('timestamp') || 0
        if (ts > 0) {
          var d = new Date(ts * 1000 - 3 * 3600 * 1000) // Brasília (UTC-3)
          msgAgg.by_weekday[d.getUTCDay()] = (msgAgg.by_weekday[d.getUTCDay()] || 0) + 1
          var hh = ('0' + d.getUTCHours()).slice(-2)
          msgAgg.by_hour[hh] = (msgAgg.by_hour[hh] || 0) + 1
        }
        var mtype = msg.getString('message_type') || 'desconhecido'
        msgAgg.by_type[mtype] = (msgAgg.by_type[mtype] || 0) + 1
        sumLen += (msg.getString('content') || '').length
        msgAgg.total++
      }
      if (msgAgg.total > 0) {
        var avg = Math.round(sumLen / msgAgg.total)
        msgAgg.avg_length_bucket =
          avg < 80 ? '<80' : avg < 200 ? '80-200' : avg < 400 ? '200-400' : '>400'
      }
    } catch (errM) {
      $app.logger().warn('cron_mentor_export: aggregates failed', 'error', String(errM))
    }

    // ── 4. REGRAS DE FOLLOW-UP ──────────────────────────────────────────
    var rulesOut = []
    try {
      var rules = $app.findRecordsByFilter('care_followup_rules', 'id != ""', 'created', 100, 0)
      for (var r = 0; r < rules.length; r++) {
        var ru = rules[r]
        rulesOut.push({
          id: ru.id,
          name: ru.getString('name') || '',
          followup_days: ru.getInt('followup_days') || 0,
        })
      }
    } catch (errR) {
      $app.logger().warn('cron_mentor_export: rules failed', 'error', String(errR))
    }

    // ── 5. ENVIO ────────────────────────────────────────────────────────
    if (contactsOut.length === 0 && apptsOut.length === 0) {
      $app.logger().info('cron_mentor_export: nothing to send')
      return
    }

    var payload = {
      type: 'crm_export',
      generated_at: new Date().toISOString(),
      source: 'crm-drcaio-43991',
      counts: {
        contacts: contactsOut.length,
        appointments: apptsOut.length,
        message_patterns: msgAgg.total,
        followup_rules: rulesOut.length,
      },
      contacts: contactsOut,
      appointments: apptsOut,
      message_patterns: msgAgg,
      followup_rules: rulesOut,
    }

    var status = 'failed'
    try {
      var res = $http.send({
        url: WEBHOOK_URL,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        timeout: 20,
      })
      if (res.statusCode >= 200 && res.statusCode < 300) status = 'sent'
      $app.logger().info('cron_mentor_export: done', 'status', status, 'http', res.statusCode)
    } catch (errS) {
      $app.logger().error('cron_mentor_export: send failed', 'error', String(errS))
    }
  } catch (fatal) {
    $app.logger().error('cron_mentor_export: fatal', 'error', String(fatal))
  }
})
