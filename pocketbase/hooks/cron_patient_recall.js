/// <reference path="../pb_data/types.d.ts" />

/**
 * CRON DE RECALL DE PACIENTES INATIVOS
 *
 * Roda diariamente às 03:15 no horário de Brasília (UTC-3), que equivale a 06:15 UTC.
 * Expressão cron: "15 6 * * *" (UTC).
 *
 * Regras:
 * - Respeita o toggle recall_enabled de care_alert_settings da conta.
 * - Parâmetros configuráveis em care_alert_settings:
 *   - recall_days_inactive (padrão: 14 dias sem mensagens)
 *   - recall_daily_limit (padrão: 15 contatos por dia)
 * - Selecionar contatos do CRM em estágio "cliente" OU com agendamento "realizado" no passado.
 * - Sem nenhuma mensagem há pelo menos recall_days_inactive dias.
 * - last_recall_sent_at nulo OU > 30 dias (garantia anti-duplicidade e cadência suave).
 * - Envia via WhatsApp (Evolution API):
 *   "Oi [Nome]! Faz uns diazinhos que não conversamos e lembrei de você com muito carinho. Como estão as coisas por aí? Qualquer coisa estou sempre aqui, viu? 🌸"
 * - Atualiza last_recall_sent_at com timestamp atual e incrementa recall_count (+1).
 * - Se o paciente responder posteriormente, o webhook já lida e o fluxo normal da Fabiana/atendente assume (nenhum novo disparo automático atropelando).
 */

cronAdd('daily_patient_recall', '15 6 * * *', () => {
  $app.logger().info('daily_patient_recall: cron started')

  var nowMs = Date.now()
  var spOffsetMs = -3 * 3600 * 1000
  var nowSpDate = new Date(nowMs + spOffsetMs)
  var nowSpDay = nowSpDate.getUTCDay()
  var nowSpHHMM =
    ('0' + nowSpDate.getUTCHours()).slice(-2) + ':' + ('0' + nowSpDate.getUTCMinutes()).slice(-2)

  function cleanDigits(val) {
    if (!val) return ''
    return String(val).replace(/\D/g, '')
  }

  function isSilenced(accountId) {
    if (!accountId) return false
    try {
      var silencePeriods = $app.findRecordsByFilter(
        'care_silence_periods',
        'account_id = {:aid} && enabled = true',
        '-created',
        50,
        0,
        { aid: accountId },
      )
      if (!silencePeriods || silencePeriods.length === 0) return false

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
        if (spWd.length > 0 && spWd.indexOf(nowSpDay) === -1) continue
        if (spStart <= spEnd) {
          if (nowSpHHMM >= spStart && nowSpHHMM < spEnd) return true
        } else {
          if (nowSpHHMM >= spStart || nowSpHHMM < spEnd) return true
        }
      }
    } catch (_) {}
    return false
  }

  function resolveEvolutionInstance(accountId) {
    var apiUrlRaw = $secrets.get('EVOLUTION_API_URL') || $os.getenv('EVOLUTION_API_URL') || ''
    var apiUrl = apiUrlRaw.endsWith('/') ? apiUrlRaw.slice(0, -1) : apiUrlRaw
    var apiKey = $secrets.get('EVOLUTION_API_KEY') || $os.getenv('EVOLUTION_API_KEY') || ''

    if (!apiUrl || !apiKey) return null

    var targetInstName = 'instance_1786021758855'
    var inst = null

    // 1. Tentar instância ativa conectada prioritária da clínica
    try {
      inst = $app.findFirstRecordByFilter(
        'whatsapp_instances',
        'instance_name = {:name} && status = "connected"',
        { name: targetInstName },
      )
    } catch (_) {}

    // 2. Tentar por account_id conectado
    if (!inst) {
      try {
        if (accountId) {
          inst = $app.findFirstRecordByFilter(
            'whatsapp_instances',
            'account_id = {:aid} && status = "connected"',
            { aid: accountId },
          )
        }
      } catch (_) {}
    }

    // 3. Qualquer conectada
    if (!inst) {
      try {
        inst = $app.findFirstRecordByFilter('whatsapp_instances', 'status = "connected"')
      } catch (_) {}
    }

    if (!inst) return null

    return {
      apiUrl: apiUrl,
      apiKey: apiKey,
      instanceName: inst.getString('instance_name'),
      userId: inst.getString('user_id'),
    }
  }

  function sendWhatsAppText(instInfo, phone, text, accountId, contactRec) {
    if (!instInfo || !phone || !text) return false
    var cleanPhone = cleanDigits(phone)
    if (cleanPhone.length < 8) return false

    var num = cleanPhone
    if (num.length === 10 || num.length === 11) {
      num = '55' + num
    }

    var remoteJid = num + '@s.whatsapp.net'
    var url = instInfo.apiUrl + '/message/sendText/' + instInfo.instanceName

    try {
      var res = $http.send({
        url: url,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: instInfo.apiKey,
        },
        body: JSON.stringify({
          number: num,
          text: text,
        }),
        timeout: 15,
      })

      if (res.statusCode >= 200 && res.statusCode < 300) {
        var sentMsgId = ''
        try {
          sentMsgId = res.json && res.json.key && res.json.key.id
        } catch (_) {}
        if (!sentMsgId) sentMsgId = 'rec_' + $security.randomString(16)

        try {
          var msgCol = $app.findCollectionByNameOrId('whatsapp_messages')
          var newMsg = new Record(msgCol)
          newMsg.set('user_id', instInfo.userId)
          if (accountId) newMsg.set('account_id', accountId)
          newMsg.set('instance_name', instInfo.instanceName)
          newMsg.set('remote_jid', remoteJid)
          newMsg.set('from_me', true)
          newMsg.set('message_id', sentMsgId)
          newMsg.set('push_name', 'Assistente')
          newMsg.set('content', text)
          newMsg.set('message_type', 'conversation')
          newMsg.set('status', 'pending')
          newMsg.set('timestamp', Math.floor(Date.now() / 1000))
          $app.save(newMsg)
        } catch (_) {}

        try {
          var conv = null
          try {
            conv = $app.findFirstRecordByFilter(
              'conversations',
              'remote_jid = {:jid} && instance_name = {:inst}',
              { jid: remoteJid, inst: instInfo.instanceName },
            )
          } catch (_) {}

          var nowUnix = Math.floor(Date.now() / 1000)
          if (conv) {
            conv.set('last_message', text)
            conv.set('last_message_timestamp', nowUnix)
            conv.set('unread_count', 0)
            $app.save(conv)
          }
        } catch (_) {}

        return true
      }
    } catch (err) {
      $app.logger().error('daily_patient_recall: send failed', 'error', String(err))
    }
    return false
  }

  // 1. Carregar contas com configurações
  var allSettings = []
  try {
    allSettings = $app.findRecordsByFilter('care_alert_settings', '', '-created', 100, 0)
  } catch (_) {}

  // Se não houver configurações, cria um fallback padrão para a primeira conta
  var accountsToProcess = []
  if (allSettings && allSettings.length > 0) {
    for (var s = 0; s < allSettings.length; s++) {
      var st = allSettings[s]
      var aid = st.getString('account_id')
      if (!aid) continue
      // Se explicitamente desligado, pular
      if (st.get('recall_enabled') === false) continue

      var daysInactive = st.getInt('recall_days_inactive') || 14
      var dailyLimit = st.getInt('recall_daily_limit') || 15
      accountsToProcess.push({
        accountId: aid,
        daysInactive: daysInactive,
        dailyLimit: dailyLimit,
      })
    }
  }

  // Se nenhuma conta foi mapeada (ex.: primeira execução), varre todas as contas com valores padrão
  if (accountsToProcess.length === 0) {
    try {
      var accs = $app.findRecordsByFilter('accounts', '', '-created', 100, 0)
      for (var a = 0; a < accs.length; a++) {
        accountsToProcess.push({
          accountId: accs[a].id,
          daysInactive: 14,
          dailyLimit: 15,
        })
      }
    } catch (_) {}
  }

  var totalSentAcrossAccounts = 0

  for (var ac = 0; ac < accountsToProcess.length; ac++) {
    var item = accountsToProcess[ac]
    var accountId = item.accountId
    var daysInactive = item.daysInactive
    var dailyLimit = item.dailyLimit

    if (isSilenced(accountId)) {
      continue
    }

    var instInfo = resolveEvolutionInstance(accountId)
    if (!instInfo) continue

    var cutoffInactiveIso = new Date(nowMs - daysInactive * 86400 * 1000).toISOString()
    var cutoffRecall30dIso = new Date(nowMs - 30 * 86400 * 1000).toISOString()

    // Buscar contatos potenciais:
    // Estágio 'cliente' OU is_patient = true
    // last_recall_sent_at nulo OU < cutoffRecall30d
    var candidateContacts = []
    try {
      candidateContacts = $app.findRecordsByFilter(
        'crm_contacts',
        'account_id = {:aid} && (stage = "cliente" || is_patient = true) && (last_recall_sent_at = "" || last_recall_sent_at < {:recallCutoff})',
        '+last_recall_sent_at',
        100,
        0,
        { aid: accountId, recallCutoff: cutoffRecall30dIso },
      )
    } catch (cErr) {
      $app.logger().warn('daily_patient_recall: query contacts failed', 'error', String(cErr))
      continue
    }

    // Também verificar se tem agendamento "realizado" no passado
    if (!candidateContacts || candidateContacts.length === 0) {
      try {
        var completedApps = $app.findRecordsByFilter(
          'appointments',
          'account_id = {:aid} && status = "realizado" && starts_at <= {:nowIso}',
          '-starts_at',
          50,
          0,
          { aid: accountId, nowIso: new Date().toISOString() },
        )
        for (var ca = 0; ca < completedApps.length; ca++) {
          var pId = completedApps[ca].getString('patient_id')
          if (pId) {
            try {
              var cRec = $app.findRecordById('crm_contacts', pId)
              var lastRec = cRec.getString('last_recall_sent_at')
              if (!lastRec || lastRec < cutoffRecall30dIso) {
                candidateContacts.push(cRec)
              }
            } catch (_) {}
          }
        }
      } catch (_) {}
    }

    if (!candidateContacts || candidateContacts.length === 0) continue

    var sentForThisAccount = 0

    for (var ci = 0; ci < candidateContacts.length; ci++) {
      if (sentForThisAccount >= dailyLimit) break

      var contact = candidateContacts[ci]
      var phone = contact.getString('phone') || contact.getString('jid')
      if (!phone) continue

      var cleanP = cleanDigits(phone)
      if (cleanP.length < 8) continue
      var phoneSuffix = cleanP.slice(-8)

      // Verificar se houve alguma mensagem recente (últimos X dias)
      var hasRecentMessage = false
      try {
        var recentMsgs = $app.findRecordsByFilter(
          'whatsapp_messages',
          'remote_jid ~ {:suf} && created >= {:cutoff}',
          '-created',
          1,
          0,
          { suf: phoneSuffix, cutoff: cutoffInactiveIso },
        )
        if (recentMsgs && recentMsgs.length > 0) {
          hasRecentMessage = true
        }
      } catch (_) {}

      if (hasRecentMessage) continue

      var fullName =
        contact.getString('contact_name') || contact.getString('push_name') || 'Paciente'
      var firstName = fullName.trim().split(' ')[0]
      if (!firstName || firstName.toLowerCase() === 'paciente') {
        firstName = 'amigo(a)'
      }

      var recallText =
        'Oi ' +
        firstName +
        '! Faz uns diazinhos que não conversamos e lembrei de você com muito carinho. Como estão as coisas por aí? Qualquer coisa estou sempre aqui, viu? 🌸'

      var sent = sendWhatsAppText(instInfo, phone, recallText, accountId, contact)
      if (sent) {
        sentForThisAccount++
        totalSentAcrossAccounts++

        var curCount = contact.getInt('recall_count') || 0
        contact.set('last_recall_sent_at', new Date().toISOString())
        contact.set('recall_count', curCount + 1)
        contact.set('care_status', 'reengajamento')
        try {
          $app.saveNoValidate(contact)
        } catch (_) {}

        $app
          .logger()
          .info('daily_patient_recall: message sent', 'contact_id', contact.id, 'name', fullName)
      }
    }
  }

  $app.logger().info('daily_patient_recall: cron finished', 'total_sent', totalSentAcrossAccounts)
})
