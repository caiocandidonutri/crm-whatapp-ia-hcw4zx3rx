/// <reference path="../pb_data/types.d.ts" />

/**
 * CRON MENTOR EXPORT — Exportação diária anonimizada para o Maestro (Mentor).
 * Executa 1x ao dia às 12:03 UTC (09:03 Brasília) + gatilho manual.
 *
 * Autorização: Dr. Caio Cândido (05/10/2026); gatilho manual autorizado 07/10.
 *
 * LGPD ESTRITA (salvaguarda do Dr. Caio, 05/10):
 * - Contatos: PRIMEIRO NOME + últimos 4 dígitos do telefone (v4, pedido do Caio).
 * - Mensagens: NENHUM texto sai do CRM. Só padrões agregados.
 * - Metadados por contato (v3, aprovados): last_inbound_at, inbound/90d, outbound/90d.
 * - Nunca envia: CPF, endereço, dados clínicos, textos de conversas.
 *
 * PocketBase JSVM: ALL logic inline in each callback (no top-level refs).
 */

cronAdd('cron_mentor_export', '3 12 * * *', () => {
  try {
    // KILL SWITCH GLOBAL
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

    function firstName(name) {
      if (!name) return 'N.N.'
      var p = String(name).trim().split(/\s+/)[0]
      return p || 'N.N.'
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
        return rec.getString(field) || ''
      } catch (_) {
        return ''
      }
    }

    // CONTATOS
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
          key: firstName(name) + '-' + phone,
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

    // AGENDAMENTOS
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
          pKey = firstName(pName) + '-' + pPhone
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

    // PADRÕES AGREGADOS (nenhum texto)
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
          var d = new Date(ts * 1000 - 3 * 3600 * 1000)
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

    // METADADOS v3 (por contato, sem texto)
    var metaByJid = {}
    var metaScanned = 0
    try {
      var cutoff90 = Math.floor(Date.now() / 1000) - 90 * 86400
      var page = 0
      while (page < 20) {
        var batch = $app.findRecordsByFilter(
          'whatsapp_messages',
          'timestamp > {:c90}',
          '-timestamp',
          500,
          page * 500,
          { c90: cutoff90 },
        )
        if (!batch || batch.length === 0) break
        for (var b = 0; b < batch.length; b++) {
          var mb = batch[b]
          var mjid = mb.getString('remote_jid') || ''
          if (!mjid) continue
          if (!metaByJid[mjid]) metaByJid[mjid] = { inCount: 0, outCount: 0, lastInTs: 0 }
          var mts = mb.getNumber('timestamp') || 0
          if (mb.getBool('from_me')) metaByJid[mjid].outCount++
          else {
            metaByJid[mjid].inCount++
            if (mts > metaByJid[mjid].lastInTs) metaByJid[mjid].lastInTs = mts
          }
          metaScanned++
        }
        if (batch.length < 500) break
        page++
      }
    } catch (errMeta) {
      $app.logger().warn('cron_mentor_export: metadata scan failed', 'error', String(errMeta))
    }
    try {
      var c2 = $app.findRecordsByFilter('crm_contacts', 'id != ""', '-updated', 1000, 0)
      for (var k2 = 0; k2 < c2.length; k2++) {
        var cc = c2[k2]
        var meta = metaByJid[cc.getString('jid') || '']
        if (!meta) continue
        for (var k3 = 0; k3 < contactsOut.length; k3++) {
          var outC = contactsOut[k3]
          if (outC.jid !== (cc.getString('jid') || '')) continue
          outC.last_inbound_at =
            meta.lastInTs > 0 ? new Date(meta.lastInTs * 1000).toISOString() : ''
          outC.inbound_count_90d = meta.inCount
          outC.outbound_count_90d = meta.outCount
        }
      }
    } catch (errAttach) {
      $app.logger().warn('cron_mentor_export: metadata attach failed', 'error', String(errAttach))
    }

    // REGRAS
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

    if (contactsOut.length === 0 && apptsOut.length === 0) {
      $app.logger().info('cron_mentor_export: nothing to send')
      return
    }

    var payload = {
      type: 'crm_export',
      generated_at: new Date().toISOString(),
      source: 'crm-drcaio-43991',
      schema: 'v4-lgpd-estrita',
      counts: {
        contacts: contactsOut.length,
        appointments: apptsOut.length,
        message_patterns: msgAgg.total,
        metadata_messages_scanned: metaScanned,
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

// GATILHO MANUAL (autorizado pelo Dr. Caio em 07/10): dispara a exportação
// sob demanda. Autentica por login OU token dedicado (header X-Mentor-Trigger).
// LGPD: usa EXATAMENTE a mesma lógica/payload do cron (inline por limitação do JSVM).
routerAdd('POST', '/backend/v1/mentor/export-now', (e) => {
  try {
    var MENTOR_TRIGGER_TOKEN = 'mtrg_7Kq93XpA2eR5vN8wL1cT'
    var byToken = false
    try {
      byToken = e.request.getHeader('X-Mentor-Trigger') === MENTOR_TRIGGER_TOKEN
    } catch (_) {}
    if (!byToken) {
      var userId = e.auth && e.auth.id
      if (!userId) return e.unauthorizedError('auth required')
    }

    try {
      var pausedRec2 = $app.findFirstRecordByFilter(
        'care_alert_settings',
        'global_automations_paused = true',
      )
      if (pausedRec2) return e.json(200, { ok: false, reason: 'automations_paused' })
    } catch (_) {}

    var WEBHOOK_URL2 =
      'https://maestro.adapta.one/webhooks/generic/e7d91885cd5ab622517a1440271160be4a65aaed67c5769b4d7898685ca7f31c?secret=22599790806c950800e685dc851a4897c050b0af17e933f0c03e64b1e9c71d4a'

    function firstName2(name) {
      if (!name) return 'N.N.'
      var p = String(name).trim().split(/\s+/)[0]
      return p || 'N.N.'
    }
    function maskPhone2(val) {
      var digits = String(val || '').replace(/\D/g, '')
      if (digits.length < 4) return ''
      return '*****' + digits.slice(-4)
    }
    function maskJid2(jid) {
      var m = String(jid || '').match(/^(\d+)@/)
      if (!m) return ''
      return maskPhone2(m[1])
    }

    var contactsOut2 = []
    try {
      var contacts2 = $app.findRecordsByFilter('crm_contacts', 'id != ""', '-updated', 1000, 0)
      for (var i2 = 0; i2 < contacts2.length; i2++) {
        var cX = contacts2[i2]
        var nameX = cX.getString('contact_name') || cX.getString('push_name') || ''
        var phoneX = maskPhone2(cX.getString('phone') || '')
        if (!phoneX) phoneX = maskJid2(cX.getString('jid') || '')
        var suggestedX = cX.getString('ai_suggested_action') || ''
        if (suggestedX.length > 120) suggestedX = suggestedX.substring(0, 120)
        contactsOut2.push({
          key: firstName2(nameX) + '-' + phoneX,
          jid: cX.getString('jid') || '',
          stage: cX.getString('stage') || '',
          role: cX.getString('role') || '',
          is_patient: cX.getBool('is_patient'),
          care_status: cX.getString('care_status') || '',
          ai_priority: cX.getNumber('ai_priority') || 0,
          created: cX.getString('created') || '',
          updated: cX.getString('updated') || '',
          converted_at: cX.getString('converted_at') || '',
          last_recall_sent_at: cX.getString('last_recall_sent_at') || '',
          recall_count: cX.getNumber('recall_count') || 0,
          ai_suggested_action: suggestedX,
        })
      }
    } catch (errC2) {
      $app.logger().warn('mentor_export_now: contacts failed', 'error', String(errC2))
    }

    var apptsOut2 = []
    try {
      var appts2 = $app.findRecordsByFilter('appointments', 'id != ""', '-starts_at', 500, 0)
      for (var a2 = 0; a2 < appts2.length; a2++) {
        var ap2 = appts2[a2]
        var pKey2 = ''
        try {
          var pRec2 = $app.findRecordById('crm_contacts', ap2.getString('patient_id'))
          var pName2 = pRec2.getString('contact_name') || pRec2.getString('push_name') || ''
          var pPhone2 = maskPhone2(pRec2.getString('phone') || '')
          if (!pPhone2) pPhone2 = maskJid2(pRec2.getString('jid') || '')
          pKey2 = firstName2(pName2) + '-' + pPhone2
        } catch (_) {}
        apptsOut2.push({
          id: ap2.id,
          patient_key: pKey2,
          starts_at: ap2.getString('starts_at') || '',
          status: ap2.getString('status') || '',
        })
      }
    } catch (errA2) {
      $app.logger().warn('mentor_export_now: appointments failed', 'error', String(errA2))
    }

    var msgAgg2 = {
      total: 0,
      by_weekday: [0, 0, 0, 0, 0, 0, 0],
      by_hour: {},
      by_type: {},
      avg_length_bucket: '',
    }
    try {
      var msgs2 = $app.findRecordsByFilter(
        'whatsapp_messages',
        'from_me = true',
        '-timestamp',
        500,
        0,
      )
      var sumLen2 = 0
      for (var m2 = 0; m2 < msgs2.length; m2++) {
        var msg2 = msgs2[m2]
        var ts2 = msg2.getNumber('timestamp') || 0
        if (ts2 > 0) {
          var d2 = new Date(ts2 * 1000 - 3 * 3600 * 1000)
          msgAgg2.by_weekday[d2.getUTCDay()] = (msgAgg2.by_weekday[d2.getUTCDay()] || 0) + 1
          var hh2 = ('0' + d2.getUTCHours()).slice(-2)
          msgAgg2.by_hour[hh2] = (msgAgg2.by_hour[hh2] || 0) + 1
        }
        var mtype2 = msg2.getString('message_type') || 'desconhecido'
        msgAgg2.by_type[mtype2] = (msgAgg2.by_type[mtype2] || 0) + 1
        sumLen2 += (msg2.getString('content') || '').length
        msgAgg2.total++
      }
      if (msgAgg2.total > 0) {
        var avg2 = Math.round(sumLen2 / msgAgg2.total)
        msgAgg2.avg_length_bucket =
          avg2 < 80 ? '<80' : avg2 < 200 ? '80-200' : avg2 < 400 ? '200-400' : '>400'
      }
    } catch (errM2) {
      $app.logger().warn('mentor_export_now: aggregates failed', 'error', String(errM2))
    }

    var metaByJid2 = {}
    var metaScanned2 = 0
    try {
      var cutoff902 = Math.floor(Date.now() / 1000) - 90 * 86400
      var page2 = 0
      while (page2 < 20) {
        var batch2 = $app.findRecordsByFilter(
          'whatsapp_messages',
          'timestamp > {:c90}',
          '-timestamp',
          500,
          page2 * 500,
          { c90: cutoff902 },
        )
        if (!batch2 || batch2.length === 0) break
        for (var b2 = 0; b2 < batch2.length; b2++) {
          var mb2 = batch2[b2]
          var mjid2 = mb2.getString('remote_jid') || ''
          if (!mjid2) continue
          if (!metaByJid2[mjid2]) metaByJid2[mjid2] = { inCount: 0, outCount: 0, lastInTs: 0 }
          var mts2 = mb2.getNumber('timestamp') || 0
          if (mb2.getBool('from_me')) metaByJid2[mjid2].outCount++
          else {
            metaByJid2[mjid2].inCount++
            if (mts2 > metaByJid2[mjid2].lastInTs) metaByJid2[mjid2].lastInTs = mts2
          }
          metaScanned2++
        }
        if (batch2.length < 500) break
        page2++
      }
    } catch (errMeta2) {
      $app.logger().warn('mentor_export_now: metadata scan failed', 'error', String(errMeta2))
    }
    for (var k4 = 0; k4 < contactsOut2.length; k4++) {
      var outD = contactsOut2[k4]
      var metaD = metaByJid2[outD.jid || '']
      if (metaD) {
        outD.last_inbound_at =
          metaD.lastInTs > 0 ? new Date(metaD.lastInTs * 1000).toISOString() : ''
        outD.inbound_count_90d = metaD.inCount
        outD.outbound_count_90d = metaD.outCount
      }
      delete outD.jid
    }

    var rulesOut2 = []
    try {
      var rules2 = $app.findRecordsByFilter('care_followup_rules', 'id != ""', 'created', 100, 0)
      for (var r2 = 0; r2 < rules2.length; r2++) {
        var ru2 = rules2[r2]
        rulesOut2.push({
          id: ru2.id,
          name: ru2.getString('name') || '',
          followup_days: ru2.getInt('followup_days') || 0,
        })
      }
    } catch (errR2) {
      $app.logger().warn('mentor_export_now: rules failed', 'error', String(errR2))
    }

    if (contactsOut2.length === 0 && apptsOut2.length === 0) {
      return e.json(200, { ok: false, reason: 'nothing_to_send' })
    }

    var payload2 = {
      type: 'crm_export',
      generated_at: new Date().toISOString(),
      source: 'crm-drcaio-43991',
      trigger: 'manual-mentor',
      schema: 'v4-lgpd-estrita',
      counts: {
        contacts: contactsOut2.length,
        appointments: apptsOut2.length,
        message_patterns: msgAgg2.total,
        metadata_messages_scanned: metaScanned2,
        followup_rules: rulesOut2.length,
      },
      contacts: contactsOut2,
      appointments: apptsOut2,
      message_patterns: msgAgg2,
      followup_rules: rulesOut2,
    }

    var http2 = 0
    try {
      var res2 = $http.send({
        url: WEBHOOK_URL2,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload2),
        timeout: 20,
      })
      http2 = res2.statusCode
      $app.logger().info('mentor_export_now: done', 'http', http2)
    } catch (errS2) {
      $app.logger().error('mentor_export_now: send failed', 'error', String(errS2))
    }
    return e.json(200, { ok: http2 >= 200 && http2 < 300, http: http2, counts: payload2.counts })
  } catch (fatal2) {
    $app.logger().error('mentor_export_now: fatal', 'error', String(fatal2))
    return e.json(500, { ok: false, error: String(fatal2) })
  }
})
