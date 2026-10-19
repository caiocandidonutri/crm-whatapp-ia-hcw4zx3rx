/// <reference path="../pb_data/types.d.ts" />

/**
 * FILA DE ENVIO WHATSAPP COM RETRY PERSISTENTE E BACKOFF EXPONENCIAL
 *
 * Executa a cada 5 minutos nos minutos escalonados: '7,17,27,37,47,57 * * * *'
 *
 * Requisitos estritos atendidos:
 * 1. KILL-SWITCH GLOBAL: se care_alert_settings.global_automations_paused = true, NUNCA dispara nada.
 * 2. NIGHT SHIELD (21h-07h horário de Brasília): NUNCA dispara nada durante a noite.
 * 3. BACKOFF EXPONENCIAL: tentativas com intervalos crescentes (1min, 2min, 4min, 8min, 16min, etc.)
 * 4. IDEMPOTÊNCIA ESTATUTÁRIA: por `message_id` — se já constar na whatsapp_messages com status de sucesso
 *    ou enviado, marca como sent imediatamente SEM reenviar para a Evolution API.
 * 5. INSTÂNCIA ATIVA: NUNCA altera nem reconecta a instância Evolution; opera em modo leitura/uso seguro.
 */

cronAdd('whatsapp_retry_queue_worker', '7,17,27,37,47,57 * * * *', () => {
  try {
    // 1. VERIFICAÇÃO DO KILL-SWITCH GLOBAL NA PRIMEIRA LINHA
    try {
      var pausedRec = $app.findFirstRecordByFilter(
        'care_alert_settings',
        'global_automations_paused = true',
      )
      if (pausedRec) {
        $app
          .logger()
          .info(
            '[whatsapp_retry_queue] Abortado: Kill-switch global está ON (global_automations_paused=true)',
          )
        return
      }
    } catch (_) {}

    // 2. VERIFICAÇÃO DO NIGHT SHIELD (21h às 07h no horário de Brasília / UTC-3)
    var nowMs = Date.now()
    var spDate = new Date(nowMs - 3 * 3600 * 1000)
    var spHour = spDate.getUTCHours()
    if (spHour >= 21 || spHour < 7) {
      $app
        .logger()
        .info('[whatsapp_retry_queue] Abortado: Night Shield ativo (21h-07h de Brasília)')
      return
    }

    var nowIso = new Date(nowMs).toISOString()

    // 3. BUSCAR MENSAGENS PENDENTES OU COM FALHA APTAS PARA RETRY
    var pendingItems = []
    try {
      pendingItems = $app.findRecordsByFilter(
        'whatsapp_send_queue',
        '(status = "pending" || status = "failed") && (next_retry_at = null || next_retry_at = "" || next_retry_at <= {:now})',
        '+created',
        20,
        0,
        { now: nowIso },
      )
    } catch (qErr) {
      // Coleção pode estar vazia ou erro transitório
      return
    }

    if (!pendingItems || pendingItems.length === 0) {
      return
    }

    var apiUrl = $secrets.get('EVOLUTION_API_URL') || $os.getenv('EVOLUTION_API_URL') || ''
    var apiKey = $secrets.get('EVOLUTION_API_KEY') || $os.getenv('EVOLUTION_API_KEY') || ''
    if (!apiUrl || !apiKey) {
      $app.logger().warn('[whatsapp_retry_queue] Credenciais da Evolution API ausentes')
      return
    }
    if (apiUrl.endsWith('/')) apiUrl = apiUrl.slice(0, -1)

    // Localizar a instância conectada oficial da clínica
    var activeInstance = null
    try {
      activeInstance = $app.findFirstRecordByFilter('whatsapp_instances', 'status = "connected"')
    } catch (_) {}

    if (!activeInstance) {
      $app.logger().warn('[whatsapp_retry_queue] Nenhuma instância conectada encontrada no CRM')
      return
    }
    var activeInstanceName = activeInstance.getString('instance_name')

    for (var i = 0; i < pendingItems.length; i++) {
      var item = pendingItems[i]
      var itemId = item.id
      var msgId = item.getString('message_id')
      var remoteJid = item.getString('remote_jid')
      var content = item.getString('content')
      var retryCount = item.getInt('retry_count') || 0
      var maxRetries = item.getInt('max_retries') || 5

      // Marca como processando temporariamente
      item.set('status', 'processing')
      try {
        $app.saveNoValidate(item)
      } catch (_) {}

      // 4. VERIFICAÇÃO DE IDEMPOTÊNCIA:
      // Se houver registro em whatsapp_messages para este message_id onde from_me=true e status!='failed',
      // ou se o envio já consta gravado, NÃO duplicamos o disparo!
      if (msgId) {
        try {
          var existingMsg = $app.findFirstRecordByFilter(
            'whatsapp_messages',
            'message_id = {:mid} && from_me = true',
            { mid: msgId },
          )
          if (existingMsg && existingMsg.getString('status') !== 'failed') {
            item.set('status', 'sent')
            item.set('sent_at', nowIso)
            item.set('last_error', 'Já entregue (idempotência detectada em whatsapp_messages)')
            $app.saveNoValidate(item)
            $app
              .logger()
              .info(
                '[whatsapp_retry_queue] Idempotência: mensagem já entregue',
                'message_id',
                msgId,
              )
            continue
          }
        } catch (_) {}
      }

      // Se excedeu o limite máximo de retries, marca como failed definitiva
      if (retryCount >= maxRetries) {
        item.set('status', 'failed')
        item.set('last_error', 'Limite máximo de tentativas atingido (' + maxRetries + ')')
        $app.saveNoValidate(item)
        $app.logger().warn('[whatsapp_retry_queue] Tentativas esgotadas para item', 'id', itemId)
        continue
      }

      // Preparar envio para Evolution API
      var targetNumber = remoteJid
      var isGroup = targetNumber.endsWith('@g.us')
      var evolutionNumber = isGroup ? targetNumber : targetNumber.split('@')[0]
      var sendUrl = apiUrl + '/message/sendText/' + activeInstanceName

      var sendSuccess = false
      var sendErrorMsg = ''
      var returnedMsgId = ''

      try {
        var res = $http.send({
          url: sendUrl,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            apikey: apiKey,
          },
          body: JSON.stringify({
            number: evolutionNumber,
            text: content,
          }),
          timeout: 10,
        })

        if (res.statusCode === 200 || res.statusCode === 201) {
          sendSuccess = true
          if (res.json && res.json.key && res.json.key.id) {
            returnedMsgId = res.json.key.id
          }
        } else {
          sendErrorMsg = 'HTTP ' + res.statusCode
        }
      } catch (httpErr) {
        sendErrorMsg = String(httpErr)
      }

      if (sendSuccess) {
        item.set('status', 'sent')
        item.set('sent_at', new Date().toISOString())
        if (returnedMsgId) item.set('message_id', returnedMsgId)
        item.set('last_error', '')
        $app.saveNoValidate(item)

        // Atualizar ou inserir mensagem em whatsapp_messages
        try {
          var finalMid = returnedMsgId || msgId
          if (finalMid) {
            var msgRec = null
            try {
              msgRec = $app.findFirstRecordByFilter('whatsapp_messages', 'message_id = {:mid}', {
                mid: finalMid,
              })
            } catch (_) {}

            if (msgRec) {
              msgRec.set('status', 'sent')
              $app.saveNoValidate(msgRec)
            } else {
              var msgCol = $app.findCollectionByNameOrId('whatsapp_messages')
              var newMsg = new Record(msgCol)
              newMsg.set(
                'account_id',
                item.getString('account_id') || activeInstance.getString('account_id'),
              )
              newMsg.set('user_id', activeInstance.getString('user_id'))
              newMsg.set('instance_name', activeInstanceName)
              newMsg.set('remote_jid', remoteJid)
              newMsg.set('from_me', true)
              newMsg.set('content', content)
              newMsg.set('message_type', 'conversation')
              newMsg.set('status', 'sent')
              newMsg.set('timestamp', Math.floor(Date.now() / 1000))
              newMsg.set('message_id', finalMid)
              $app.save(newMsg)
            }
          }
        } catch (_) {}

        $app
          .logger()
          .info('[whatsapp_retry_queue] Mensagem enviada com sucesso pela fila', 'queue_id', itemId)
      } else {
        // FALHA: Calcular próximo retry com backoff exponencial
        // Backoff: 1min * (2 ^ retryCount), exemplo: retry 0 => 1min, retry 1 => 2min, retry 2 => 4min, retry 3 => 8min, etc.
        var nextRetryCount = retryCount + 1
        var backoffMinutes = Math.pow(2, retryCount) // 1, 2, 4, 8, 16...
        var nextRetryMs = Date.now() + backoffMinutes * 60 * 1000
        var nextRetryIso = new Date(nextRetryMs).toISOString()

        item.set('status', 'failed')
        item.set('retry_count', nextRetryCount)
        item.set('next_retry_at', nextRetryIso)
        item.set('last_error', sendErrorMsg)
        $app.saveNoValidate(item)

        $app
          .logger()
          .warn(
            '[whatsapp_retry_queue] Falha no reenvio. Próxima tentativa agendada com backoff',
            'retry',
            nextRetryCount,
            'next_retry_in_minutes',
            backoffMinutes,
            'error',
            sendErrorMsg,
          )
      }
    }
  } catch (fatalErr) {
    $app.logger().error('[whatsapp_retry_queue] Erro fatal no worker', 'error', String(fatalErr))
  }
})
