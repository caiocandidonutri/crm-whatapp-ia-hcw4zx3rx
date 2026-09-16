/// <reference path="../pb_data/types.d.ts" />

/**
 * CRON DE CONFIRMAÇÃO, LEMBRETES E FOLLOW-UP DE AGENDAMENTOS
 *
 * Roda nos minutos 4, 9, 14, 19, 24, 29, 34, 39, 44, 49, 54, 59.
 * Escalonado para não colidir com o cron de sync da agenda (minuto 2) nem com outros crons.
 *
 * Regras:
 * - Timezone America/Sao_Paulo (UTC-3) em todos os cálculos.
 * - Respeita reminders_enabled de care_alert_settings.
 * - Respeita períodos de silêncio configurados em care_silence_periods.
 * - Varre appointments com status "agendado":
 *   1) ~24h antes (véspera, entre 20h e 28h antes do starts_at):
 *      Se confirmation_sent_at for nulo, envia confirmação 1x e seta confirmation_sent_at.
 *      Texto EXATO:
 *      "Bom dia [Nome]! Tudo bem? Um dia abençoado pra você! Passando para confirmar seu horário com o Dr. Caio amanhã às [HH:MM]. Você nos confirma a presença? 🙏✨"
 *      (ou Boa tarde/Boa noite conforme hora de disparo, embora o template peça "Bom dia [Nome]! Tudo bem? Um dia abençoado pra você! Passando para confirmar seu horário com o Dr. Caio amanhã às [HH:MM]. Você nos confirma a presença? 🙏✨").
 *      Se o tipo envolver consulta/bioimpedância (case-insensitive "bioimped" ou "consulta" ou "primeira" ou "retorno"),
 *      acrescentar o bloco de preparo:
 *      "\n\nInstruções de preparo:\n- Jejum de 2 a 3 horas de alimentos e água\n- Não ingerir cafeína, energéticos ou bebidas alcoólicas nas 24h anteriores\n- Não praticar atividade física pesada no dia\n- Urinar cerca de 30 minutos antes do atendimento\n- Mulheres: evitar o período menstrual, se possível."
 *   2) No dia (2 a 3h antes do starts_at):
 *      Se reminder_day_sent_at for nulo, envia lembrete 1x e seta reminder_day_sent_at:
 *      "Boa tarde [Nome]! Passando para lembrar do seu horário daqui a pouco ✨ às [HH:MM]. Dr. Caio já está te esperando!"
 *      (usar Bom dia / Boa tarde / Boa noite conforme a hora real de envio no Brasil).
 *   3) Se 6h após a confirmação enviada o paciente NÃO respondeu (followup_sent_at nulo, status ainda "agendado", sem resposta do paciente):
 *      Enviar 1 follow-up leve único:
 *      "Oi [Nome]! Só confirmando se você vai conseguir vir amanhã, tá bom? Me avisa por aqui 🙏"
 *      e setar followup_sent_at.
 *   4) Se já enviou o follow-up e se passaram pelo menos 2h (ou já está próximo do atendimento) e task_created_at for nulo:
 *      Criar notificação e tarefa humana na central de cuidado existente (coleção tasks com care_category="precisa_retorno" ou "precisa_atencao")
 *      e setar task_created_at no agendamento, sem disparar mais mensagens automáticas.
 */

cronAdd('appointment_reminders_and_followup', '4,9,14,19,24,29,34,39,44,49,54,59 * * * *', () => {
  var nowMs = Date.now()
  // Offset fixo de Brasília: UTC-3
  var spOffsetMs = -3 * 3600 * 1000
  var nowSpDate = new Date(nowMs + spOffsetMs)
  var nowSpHour = nowSpDate.getUTCHours()
  var nowSpMinute = nowSpDate.getUTCMinutes()
  var nowSpDay = nowSpDate.getUTCDay()
  var nowSpHHMM = ('0' + nowSpHour).slice(-2) + ':' + ('0' + nowSpMinute).slice(-2)

  function getGreeting(hour) {
    if (hour >= 5 && hour < 12) return 'Bom dia'
    if (hour >= 12 && hour < 18) return 'Boa tarde'
    return 'Boa noite'
  }

  function cleanDigits(val) {
    if (!val) return ''
    return String(val).replace(/\D/g, '')
  }

  function formatTimeHHMM(dateIso) {
    if (!dateIso) return 'horário combinado'
    try {
      var d = new Date(dateIso)
      var dSp = new Date(d.getTime() + spOffsetMs)
      return ('0' + dSp.getUTCHours()).slice(-2) + ':' + ('0' + dSp.getUTCMinutes()).slice(-2)
    } catch (_) {
      return 'horário combinado'
    }
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

  function sendWhatsAppText(instInfo, phone, text, accountId, appointmentRec) {
    if (!instInfo || !phone || !text) return false
    var cleanPhone = cleanDigits(phone)
    if (cleanPhone.length < 8) return false

    // Formata o número (se não tiver DDI 55, adiciona)
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
        // Grava mensagem na whatsapp_messages
        var sentMsgId = ''
        try {
          sentMsgId = res.json && res.json.key && res.json.key.id
        } catch (_) {}
        if (!sentMsgId) sentMsgId = 'rem_' + $security.randomString(16)

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

        // Atualiza conversa
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
            if (appointmentRec && !appointmentRec.getString('conversation_id')) {
              appointmentRec.set('conversation_id', conv.id)
            }
          }
        } catch (_) {}

        return true
      }
    } catch (err) {
      $app.logger().error('sendWhatsAppText error', 'error', String(err))
    }
    return false
  }

  // 1. Carregar configurações de care_alert_settings e verificar Kill Switch Global
  var settingsMap = {}
  try {
    var allSettings = $app.findRecordsByFilter('care_alert_settings', '', '-created', 200, 0)
    for (var s = 0; s < allSettings.length; s++) {
      var accId = allSettings[s].getString('account_id')
      if (accId) {
        settingsMap[accId] = allSettings[s]
      }
    }
  } catch (_) {}

  function isGlobalAutomationsPaused(accountId) {
    try {
      if (accountId && settingsMap[accountId]) {
        if (settingsMap[accountId].getBool('global_automations_paused')) return true
      }
      // Se não encontrou por accountId ou se accountId é vazio, checar se qualquer registro de care_alert_settings está com Kill Switch ativo
      for (var k in settingsMap) {
        if (settingsMap[k].getBool('global_automations_paused')) return true
      }
    } catch (_) {}
    return false
  }

  // 2. Buscar agendamentos com status "agendado" a partir de hoje até 3 dias no futuro
  // starts_at >= now - 1 dia (para pegar os que precisam de follow-up pós-confirmação)
  // NIGHT SHIELD: não disparar lembretes automáticos entre 21h e 07h de Brasília
  function isNightShieldActive() {
    var nMs = Date.now()
    var spD = new Date(nMs - 3 * 3600 * 1000)
    var hSp = spD.getUTCHours()
    return hSp >= 21 || hSp < 7
  }

  if (isNightShieldActive()) {
    $app
      .logger()
      .info('appointment_reminders: skip devido ao Night Shield ativo (21h-07h de Brasília)')
    return
  }

  var minIso = new Date(nowMs - 24 * 3600 * 1000).toISOString()
  var maxIso = new Date(nowMs + 48 * 3600 * 1000).toISOString()

  var appointments = []
  try {
    appointments = $app.findRecordsByFilter(
      'appointments',
      'status = "agendado" && starts_at >= {:minDate} && starts_at <= {:maxDate}',
      '+starts_at',
      300,
      0,
      { minDate: minIso, maxDate: maxIso },
    )
  } catch (err) {
    $app.logger().error('appointment_reminders: query error', 'error', String(err))
    return
  }

  if (!appointments || appointments.length === 0) return

  for (var i = 0; i < appointments.length; i++) {
    try {
      var app = appointments[i]
      var accountId = app.getString('account_id')

      // KILL SWITCH GLOBAL: se automações estiverem pausadas, interrompe e NUNCA marca flags
      if (isGlobalAutomationsPaused(accountId)) {
        $app
          .logger()
          .info(
            'Envio cancelado: automações globais pausadas',
            'cron',
            'appointment_reminders',
            'app_id',
            app.id,
          )
        continue
      }

      // Verificar toggle reminders_enabled
      var settings = accountId ? settingsMap[accountId] : null
      // Se tiver registro de care_alert_settings e reminders_enabled for falso explícito, pular
      if (settings && settings.get('reminders_enabled') === false) {
        continue
      }

      // Período de silêncio da conta
      if (isSilenced(accountId)) {
        continue
      }

      var startsAtStr = app.getString('starts_at')
      if (!startsAtStr) continue

      var startsAtMs = new Date(startsAtStr).getTime()
      var diffHours = (startsAtMs - nowMs) / (3600 * 1000)

      var patientName = app.getString('patient_name') || 'Paciente'
      var firstName = patientName.trim().split(' ')[0]
      var phone = app.getString('patient_phone')

      // Se não tiver phone no agendamento, tentar puxar do crm_contact ou da conversation
      if (!phone) {
        var patId = app.getString('patient_id')
        if (patId) {
          try {
            var cRec = $app.findRecordById('crm_contacts', patId)
            phone = cRec.getString('phone') || cRec.getString('jid')
          } catch (_) {}
        }
      }
      if (!phone) {
        var cId = app.getString('conversation_id')
        if (cId) {
          try {
            var convRec = $app.findRecordById('conversations', cId)
            phone = convRec.getString('contact_phone') || convRec.getString('remote_jid')
          } catch (_) {}
        }
      }

      if (!phone) continue

      var confirmationSentAt = app.getString('confirmation_sent_at')
      var reminderDaySentAt = app.getString('reminder_day_sent_at')
      var followupSentAt = app.getString('followup_sent_at')
      var taskCreatedAt = app.getString('task_created_at')
      var appStatus = app.getString('status')
      var lastInterType = app.getString('last_interaction_type')

      // Anti-duplicação Fabiana Humana / Paciente já interagiu:
      // Se status já for 'confirmado', 'realizado', 'cancelado' ou 'remarcado', pular disparos de confirmação
      if (
        appStatus === 'confirmado' ||
        appStatus === 'realizado' ||
        appStatus === 'cancelado' ||
        lastInterType === 'confirmado_paciente' ||
        lastInterType === 'confirmado_manual'
      ) {
        continue
      }

      // Verificação no histórico do chat: se a Fabiana já enviou mensagem de confirmação/agendamento
      // manualmente nas últimas 36h, marca como confirmado_manual e NÃO dispara duplicado!
      var cleanPhoneDigits = cleanDigits(phone)
      if (cleanPhoneDigits && !confirmationSentAt) {
        try {
          var pSuf = cleanPhoneDigits.length > 8 ? cleanPhoneDigits.slice(-8) : cleanPhoneDigits
          var recentManualMsgs = $app.findRecordsByFilter(
            'whatsapp_messages',
            'from_me = true && remote_jid ~ {:suf} && created >= {:cutoff}',
            '-created',
            5,
            0,
            {
              suf: pSuf,
              cutoff: new Date(Date.now() - 36 * 3600 * 1000).toISOString(),
            },
          )
          var humanAlreadySent = false
          if (recentManualMsgs && recentManualMsgs.length > 0) {
            for (var rmi = 0; rmi < recentManualMsgs.length; rmi++) {
              var mContent = (recentManualMsgs[rmi].getString('content') || '').toLowerCase()
              if (
                mContent.indexOf('confirm') !== -1 ||
                mContent.indexOf('consulta') !== -1 ||
                mContent.indexOf('agendamento') !== -1 ||
                mContent.indexOf('dr. caio') !== -1 ||
                mContent.indexOf('dr caio') !== -1
              ) {
                humanAlreadySent = true
                break
              }
            }
          }
          if (humanAlreadySent) {
            $app
              .logger()
              .info(
                'appointment_reminders: Fabiana already sent manual confirmation',
                'app_id',
                app.id,
                'patient',
                patientName,
              )
            app.set('confirmation_sent_at', new Date().toISOString())
            app.set('last_interaction_type', 'confirmado_manual')
            $app.saveNoValidate(app)
            confirmationSentAt = app.getString('confirmation_sent_at')
          }
        } catch (manualChkErr) {
          $app
            .logger()
            .warn('appointment_reminders: manual check error', 'error', String(manualChkErr))
        }
      }

      var appType = (app.getString('appointment_type') || '').toLowerCase()
      var notes = (app.getString('notes') || '').toLowerCase()
      var isBioOrConsult =
        appType.indexOf('bio') !== -1 ||
        appType.indexOf('consulta') !== -1 ||
        appType.indexOf('primeira') !== -1 ||
        appType.indexOf('retorno') !== -1 ||
        notes.indexOf('bioimped') !== -1

      var prepInstructions =
        '\n\nInstruções de preparo:\n- Jejum de 2 a 3 horas de alimentos e água\n- Não ingerir cafeína, energéticos ou bebidas alcoólicas nas 24h anteriores\n- Não praticar atividade física pesada no dia\n- Urinar cerca de 30 minutos antes do atendimento\n- Mulheres: evitar o período menstrual, se possível.'

      var hhmm = formatTimeHHMM(startsAtStr)

      // Instância Evolution pronta
      var instInfo = null

      // CASO 1: Véspera (~24h antes: janela entre 18h e 30h antes)
      // Anti-duplicidade: confirmation_sent_at DEVE ser nulo
      if (!confirmationSentAt && diffHours >= 18 && diffHours <= 30) {
        instInfo = resolveEvolutionInstance(accountId)
        if (instInfo) {
          // Mensagem de confirmação 24h alinhada ao tom da Fabiana (secretária da clínica)
          // Tom humano, caloroso, profissional e acolhedor (sem auto-identificação como IA)
          var confText =
            'Olá, ' +
            firstName +
            ', tudo bem? Aqui é da equipe do Dr. Caio!\n\n' +
            'Estou passando para confirmar o seu horário de consulta amanhã às *' +
            hhmm +
            '*. Podemo contar com você? 🙏'

          if (isBioOrConsult) {
            confText += prepInstructions
          }

          confText +=
            '\n\nSó responder com um *SIM* para confirmar, ou nos avise por aqui se precisar remarcar. Tenha um excelente dia!'

          var okConf = sendWhatsAppText(instInfo, phone, confText, accountId, app)
          if (okConf) {
            app.set('confirmation_sent_at', new Date().toISOString())
            app.set('last_interaction_type', 'confirmacao_24h')
            $app.saveNoValidate(app)
            $app.logger().info('appointment_reminders: confirmation 24h sent', 'app_id', app.id)
            continue
          }
        }
      }

      // CASO 2: No dia (2 a 3h antes: janela entre 1.5h e 3.5h antes)
      // Anti-duplicidade: reminder_day_sent_at DEVE ser nulo
      if (!reminderDaySentAt && diffHours >= 1.5 && diffHours <= 3.5) {
        instInfo = instInfo || resolveEvolutionInstance(accountId)
        if (instInfo) {
          var greet = getGreeting(nowSpHour)
          var reminderText =
            greet +
            ' ' +
            firstName +
            '! Passando para lembrar do seu horário daqui a pouco ✨ às ' +
            hhmm +
            '. Dr. Caio já está te esperando!'

          var okRem = sendWhatsAppText(instInfo, phone, reminderText, accountId, app)
          if (okRem) {
            app.set('reminder_day_sent_at', new Date().toISOString())
            app.set('last_interaction_type', 'lembrete_dia')
            $app.saveNoValidate(app)
            $app.logger().info('appointment_reminders: day reminder sent', 'app_id', app.id)
            continue
          }
        }
      }

      // CASO 3: Follow-up leve (6h após a confirmação enviada se o paciente não respondeu)
      // Condição: confirmation_sent_at existe, followup_sent_at é nulo, passaram-se >= 6h
      // e o paciente ainda não respondeu (verificar se houve mensagem from_me=false após confirmation_sent_at)
      if (confirmationSentAt && !followupSentAt) {
        var confSentMs = new Date(confirmationSentAt).getTime()
        var hoursSinceConf = (nowMs - confSentMs) / (3600 * 1000)

        if (hoursSinceConf >= 6 && diffHours > 3) {
          // Checar se paciente respondeu após confirmation_sent_at
          var cleanP = cleanDigits(phone)
          var suf = cleanP.slice(-8)
          var hasPatientReply = false
          try {
            var replies = $app.findRecordsByFilter(
              'whatsapp_messages',
              'remote_jid ~ {:suf} && from_me = false && created >= {:sentDate}',
              '-created',
              1,
              0,
              { suf: suf, sentDate: confirmationSentAt },
            )
            if (replies && replies.length > 0) {
              hasPatientReply = true
            }
          } catch (_) {}

          if (!hasPatientReply) {
            instInfo = instInfo || resolveEvolutionInstance(accountId)
            if (instInfo) {
              var followText =
                'Oi, ' +
                firstName +
                '! Tudo bem? Passando só para confirmar se você vai conseguir vir à consulta com o Dr. Caio amanhã, tá bom? Se puder me responder por aqui eu já deixo confirmado na agenda. Obrigada! 🙏'
              var okFollow = sendWhatsAppText(instInfo, phone, followText, accountId, app)
              if (okFollow) {
                app.set('followup_sent_at', new Date().toISOString())
                app.set('last_interaction_type', 'followup_6h')
                $app.saveNoValidate(app)
                $app.logger().info('appointment_reminders: followup 6h sent', 'app_id', app.id)
                continue
              }
            }
          }
        }
      }

      // CASO 4: Se já enviou o follow-up e o paciente ainda não respondeu (>= 2h após followup_sent_at ou próximo da consulta)
      // e task_created_at é nulo: criar tarefa/notificação humana na central de cuidado
      if (followupSentAt && !taskCreatedAt) {
        var followSentMs = new Date(followupSentAt).getTime()
        var hoursSinceFollow = (nowMs - followSentMs) / (3600 * 1000)

        if (hoursSinceFollow >= 2 || diffHours <= 12) {
          // Criar notificação/tarefa humana
          try {
            var taskCol = $app.findCollectionByNameOrId('tasks')
            var newTask = new Record(taskCol)
            var crmContactId = app.getString('patient_id') || ''
            var convId = app.getString('conversation_id') || ''

            newTask.set('title', 'Confirmar presença: ' + patientName)
            newTask.set(
              'description',
              'Paciente não respondeu às mensagens de confirmação e follow-up para a consulta marcada para ' +
                formatTimeHHMM(startsAtStr) +
                '. Entrar em contato via WhatsApp/telefone.',
            )
            newTask.set('status', 'pendente')
            newTask.set('priority', 'alta')
            newTask.set('care_category', 'precisa_retorno')
            if (accountId) newTask.set('account_id', accountId)
            if (crmContactId) newTask.set('crm_contact_id', crmContactId)
            if (convId) newTask.set('conversation_id', convId)

            // Atribuir para dono ou primeiro admin da conta
            try {
              var mem = $app.findFirstRecordByFilter('account_members', 'account_id = {:aid}', {
                aid: accountId,
              })
              if (mem) newTask.set('user_id', mem.getString('user_id'))
            } catch (_) {}

            $app.save(newTask)

            // Criar notificação para o usuário
            try {
              var notifCol = $app.findCollectionByNameOrId('notifications')
              var notif = new Record(notifCol)
              if (newTask.getString('user_id')) notif.set('user_id', newTask.getString('user_id'))
              if (accountId) notif.set('account_id', accountId)
              notif.set('type', 'task')
              notif.set('title', 'Sem resposta de confirmação: ' + patientName)
              notif.set(
                'body',
                'Paciente ' + patientName + ' não confirmou presença para ' + hhmm + '.',
              )
              notif.set('task_id', newTask.id)
              if (crmContactId) notif.set('crm_contact_id', crmContactId)
              if (convId) notif.set('conversation_id', convId)
              notif.set('read', false)
              $app.save(notif)
            } catch (_) {}

            app.set('task_created_at', new Date().toISOString())
            $app.saveNoValidate(app)
            $app.logger().info('appointment_reminders: human task created', 'app_id', app.id)
          } catch (tErr) {
            $app.logger().error('appointment_reminders: task create failed', 'error', String(tErr))
          }
        }
      }
    } catch (itemErr) {
      $app.logger().warn('appointment_reminders: item error', 'error', String(itemErr))
    }
  }
})
