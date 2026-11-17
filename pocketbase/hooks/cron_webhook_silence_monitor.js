// MONITOR DE SILÊNCIO DO WEBHOOK (a cada 15min)
// Detecta webhook morto: instância connected + nenhum evento há >15min
// (heartbeat last_webhook_event_at gravado por whatsapp_webhook.js).
// Ação:
//  - FORA do Night Shield (21h-07h): refaz o webhook/set da Evolution
//    automaticamente (única escrita permitida na Evolution — nunca logout,
//    restart, delete) e cria task "Webhook silencioso".
//  - DENTRO do Night Shield: só cria a task (nenhuma chamada de escrita na
//    Evolution de madrugada).
// NUNCA envia mensagem e NUNCA apaga nada. ISENTO do kill-switch global
// (global_automations_paused): o kill-switch existe para impedir ENVIO de
// mensagem ao paciente — este cron não envia; bloquear aqui deixaria o
// espelhamento cego justamente quando o usuário pausou as automações.
cronAdd('webhook_silence_monitor', '*/15 * * * *', () => {
  try {
    var urlStr = $secrets.get('EVOLUTION_API_URL') || ''
    var apiUrl = urlStr.endsWith('/') ? urlStr.slice(0, -1) : urlStr
    var apiKey = $secrets.get('EVOLUTION_API_KEY') || ''
    // Mesma precedência do whatsapp_webhook.js/whatsapp_status.js: PB_WEBHOOK_URL,
    // caindo para PB_INSTANCE_URL e POCKETBASE_URL (a URL pública do backend).
    var pbUrl = (
      $secrets.get('PB_WEBHOOK_URL') ||
      $secrets.get('PB_INSTANCE_URL') ||
      $secrets.get('POCKETBASE_URL') ||
      ''
    ).trim()
    var webhookUrl = pbUrl ? pbUrl.replace(/\/$/, '') + '/backend/v1/whatsapp/webhook' : ''

    if (!apiUrl || !apiKey) return

    // Night Shield 21h-07h (horário de Brasília): sem escrita na Evolution.
    var hSp = new Date(Date.now() - 3 * 3600 * 1000).getUTCHours()
    var nightShield = hSp >= 21 || hSp < 7

    var nowSecs = Math.floor(Date.now() / 1000)

    var instances = $app.findRecordsByFilter(
      'whatsapp_instances',
      "status = 'connected'",
      '-created',
      10,
      0,
    )
    if (!instances || instances.length === 0) return

    for (var i = 0; i < instances.length; i++) {
      var inst = instances[i]
      var instanceName = inst.getString('instance_name')
      if (!instanceName) continue

      // Heartbeat: último POST recebido no webhook desta instância.
      var lastEventTs = 0
      try {
        var heRaw = inst.getString('last_webhook_event_at') || ''
        if (heRaw) {
          var heMs = Date.parse(heRaw.replace(' ', 'T') + (heRaw.indexOf('Z') >= 0 ? '' : 'Z'))
          if (isFinite(heMs)) lastEventTs = Math.floor(heMs / 1000)
        }
      } catch (_) {}
      // Fallback: timestamp da última mensagem gravada (o webhook grava a
      // mensagem ao receber messages.upsert).
      if (lastEventTs === 0) {
        try {
          var lastMsgs = $app.findRecordsByFilter(
            'whatsapp_messages',
            'instance_name = {:inst} && timestamp > 0',
            '-timestamp',
            1,
            0,
            { inst: instanceName },
          )
          if (lastMsgs.length > 0) lastEventTs = lastMsgs[0].getInt('timestamp') || 0
        } catch (_) {}
      }

      // Sem heartbeat nenhum (nunca recebeu evento pós-deploy): não alarmar
      // de cara — pula e aguarda o primeiro evento estabelecer a linha de base.
      if (lastEventTs === 0) continue

      var silenceSecs = nowSecs - lastEventTs
      if (silenceSecs <= 15 * 60) continue

      // Silêncio >15min numa instância connected = webhook morto suspeito.
      $app
        .logger()
        .warn('webhook_silence_detected', 'instance', instanceName, 'silence_secs', silenceSecs)

      // 1) Reconfigurar webhook (só fora do Night Shield).
      if (!nightShield && webhookUrl) {
        try {
          // Confere antes de regravar: se já está correto na Evolution, o
          // silêncio tem outra causa — não adianta regravar o mesmo valor.
          var resFind = $http.send({
            url: apiUrl + '/webhook/find/' + instanceName,
            method: 'GET',
            headers: { apikey: apiKey, 'Content-Type': 'application/json' },
            timeout: 5,
          })
          var curUrl = ''
          if (resFind.json) {
            curUrl = resFind.json.url || (resFind.json.webhook && resFind.json.webhook.url) || ''
          }
          if (curUrl !== webhookUrl) {
            $http.send({
              url: apiUrl + '/webhook/set/' + instanceName,
              method: 'POST',
              headers: { apikey: apiKey, 'Content-Type': 'application/json' },
              body: JSON.stringify({
                enabled: true,
                url: webhookUrl,
                byEvents: false,
                base64: true,
                events: [
                  'MESSAGES_UPSERT',
                  'MESSAGES_UPDATE',
                  'MESSAGES_SET',
                  'CONNECTION_UPDATE',
                  'QRCODE_UPDATED',
                  'CHATS_UPSERT',
                  'CHATS_UPDATE',
                ],
              }),
              timeout: 5,
            })
            try {
              inst.set('last_webhook_reconfigured_at', new Date().toISOString().replace('T', ' '))
              $app.save(inst)
            } catch (_) {}
            $app.logger().info('webhook_silence_monitor_reconfigured', 'instance', instanceName)
          }
        } catch (whErr) {
          $app.logger().warn('webhook_silence_monitor_wh_error', 'error', String(whErr))
        }
      }

      // 2) Task "Webhook silencioso" (dedupe: não repetir task aberta igual).
      try {
        var existing = $app.findRecordsByFilter(
          'tasks',
          "title ~ 'Webhook silencioso' && status = 'pendente'",
          '-created',
          1,
          0,
        )
        // Checagem: task aberta igual já existe (descrição contém a instância)?
        var alreadyOpen = false
        for (var t2 = 0; t2 < existing.length; t2++) {
          var desc = existing[t2].getString('description') || ''
          if (desc.indexOf(instanceName) >= 0) {
            alreadyOpen = true
            break
          }
        }
        if (!alreadyOpen) {
          var tasksCol = $app.findCollectionByNameOrId('tasks')
          var task = new Record(tasksCol)
          var accId = inst.getString('account_id')
          task.set('user_id', inst.getString('user_id'))
          if (accId) task.set('account_id', accId)
          task.set('title', 'Webhook silencioso: ' + instanceName)
          task.set(
            'description',
            'A instância WhatsApp "' +
              instanceName +
              '" está connected mas nenhum evento do webhook chegou há ' +
              Math.floor(silenceSecs / 60) +
              ' minutos (último evento em ' +
              new Date(lastEventTs * 1000).toISOString() +
              '). ' +
              (nightShield
                ? 'Night Shield ativo: o webhook NÃO foi reconfigurado automaticamente — regravar manualmente ao acordar ou despausar.'
                : 'O webhook foi reconfigurado automaticamente na Evolution API.') +
              ' Nenhuma mensagem foi enviada. Verificar entrega de eventos em /conversas.',
          )
          task.set('status', 'pendente')
          task.set('priority', 'alta')
          task.set('care_category', 'precisa_atencao')
          $app.save(task)
        }
      } catch (taskErr) {
        $app.logger().warn('webhook_silence_monitor_task_error', 'error', String(taskErr))
      }
    }
  } catch (fatalErr) {
    $app.logger().error('webhook_silence_monitor_fatal', 'error', String(fatalErr))
  }
})
