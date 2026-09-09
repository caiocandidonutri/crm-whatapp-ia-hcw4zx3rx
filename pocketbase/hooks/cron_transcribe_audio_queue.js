// Cron para processamento da fila de transcrição de áudios
// Executa a cada minuto buscando mensagens de áudio elegíveis para transcrição
// Regras de elegibilidade (enxugamento de custos):
// 1. NÃO transcrever: contatos no estágio "cliente" (fechados).
// 2. NÃO transcrever: conversas arquivadas OU sem movimentação há mais de 7 dias.
// 3. Transcrever: leads e "em atendimento" com movimentação nos últimos 7 dias.
// 4. Limite diário configurável com pausa automática e log ao atingir o teto.
// 5. Cooldown de 6 horas por contato para reclassificação IA, com prompt enxuto (8 msgs, transcrição max 200 chars).

cronAdd('transcribe_audio_queue', '* * * * *', () => {
  const openAiKey = $secrets.get('OPENAI_API_KEY') || $os.getenv('OPENAI_API_KEY')

  if (!openAiKey) {
    console.log('[transcribe_audio_queue] Pulando: OPENAI_API_KEY não encontrada em secrets/env.')
    return
  }

  // --- Funções de controle de teto diário (escopo do callback) ---
  function getSpDayKey() {
    const d = new Date()
    const utc = d.getTime() + d.getTimezoneOffset() * 60000
    const spTime = new Date(utc - 3 * 3600000)
    const y = spTime.getFullYear()
    const m = String(spTime.getMonth() + 1).padStart(2, '0')
    const day = String(spTime.getDate()).padStart(2, '0')
    return y + '-' + m + '-' + day
  }

  function getDailyUsage(accId) {
    const dayKey = getSpDayKey()
    const filter = accId
      ? "day_key = '" + dayKey + "' && account_id = '" + accId + "'"
      : "day_key = '" + dayKey + "'"
    let rec = null
    try {
      rec = $app.findFirstRecordByFilter('app_daily_usage', filter)
    } catch (_) {}

    if (!rec) {
      try {
        const col = $app.findCollectionByNameOrId('app_daily_usage')
        rec = new Record(col)
        rec.set('day_key', dayKey)
        if (accId) rec.set('account_id', accId)
        rec.set('transcriptions_count', 0)
        rec.set('transcriptions_limit', 150)
        rec.set('ai_analyses_count', 0)
        rec.set('ai_analyses_limit', 200)
        rec.set('transcriptions_paused', false)
        rec.set('ai_analyses_paused', false)
        $app.save(rec)
      } catch (_) {
        try {
          rec = $app.findFirstRecordByFilter('app_daily_usage', filter)
        } catch (_) {}
      }
    }
    return rec
  }

  function canTranscribe(accId) {
    const u = getDailyUsage(accId)
    if (!u) return true
    const count = u.getInt('transcriptions_count') || 0
    const limit = u.getInt('transcriptions_limit') || 150
    const paused = u.getBool('transcriptions_paused')
    if (paused || count >= limit) {
      if (!paused) {
        u.set('transcriptions_paused', true)
        try {
          $app.save(u)
        } catch (_) {}
        $app
          .logger()
          .warn(
            '[TETO_DIARIO] Teto diário de transcrições atingido (' +
              count +
              '/' +
              limit +
              '). Pausa automática ativada para o dia ' +
              u.getString('day_key') +
              '.',
          )
      }
      return false
    }
    return true
  }

  function recordTranscription(accId) {
    const u = getDailyUsage(accId)
    if (!u) return
    const count = (u.getInt('transcriptions_count') || 0) + 1
    const limit = u.getInt('transcriptions_limit') || 150
    u.set('transcriptions_count', count)
    if (count >= limit) {
      u.set('transcriptions_paused', true)
      $app
        .logger()
        .warn(
          '[TETO_DIARIO] Teto diário de transcrições atingido (' +
            count +
            '/' +
            limit +
            '). Pausa automática ativada para o dia ' +
            u.getString('day_key') +
            '.',
        )
    }
    try {
      $app.save(u)
    } catch (_) {}
  }

  function canAnalyzeAi(accId) {
    const u = getDailyUsage(accId)
    if (!u) return true
    const count = u.getInt('ai_analyses_count') || 0
    const limit = u.getInt('ai_analyses_limit') || 200
    const paused = u.getBool('ai_analyses_paused')
    if (paused || count >= limit) {
      if (!paused) {
        u.set('ai_analyses_paused', true)
        try {
          $app.save(u)
        } catch (_) {}
        $app
          .logger()
          .warn(
            '[TETO_DIARIO] Teto diário de análises IA atingido (' +
              count +
              '/' +
              limit +
              '). Pausa automática ativada para o dia ' +
              u.getString('day_key') +
              '.',
          )
      }
      return false
    }
    return true
  }

  function recordAiAnalysis(accId) {
    const u = getDailyUsage(accId)
    if (!u) return
    const count = (u.getInt('ai_analyses_count') || 0) + 1
    const limit = u.getInt('ai_analyses_limit') || 200
    u.set('ai_analyses_count', count)
    if (count >= limit) {
      u.set('ai_analyses_paused', true)
      $app
        .logger()
        .warn(
          '[TETO_DIARIO] Teto diário de análises IA atingido (' +
            count +
            '/' +
            limit +
            '). Pausa automática ativada para o dia ' +
            u.getString('day_key') +
            '.',
        )
    }
    try {
      $app.save(u)
    } catch (_) {}
  }

  try {
    const nowSec = Math.floor(Date.now() / 1000)
    const sevenDaysAgoSec = nowSec - 7 * 86400

    // Busca até 10 mensagens candidatas de áudio sem transcrição
    // Exclui marcadas com SKIP_NO_TRANSCRIBE
    const candidateAudios = $app.findRecordsByFilter(
      'whatsapp_messages',
      "(message_type = 'audioMessage' || message_type = 'audio' || message_type = 'ptt' || media_file ~ '.ogg' || media_filename ~ '.ogg') && transcription = '' && media_file != ''",
      '+created',
      10,
      0,
    )

    if (!candidateAudios || candidateAudios.length === 0) {
      return
    }

    const baseFilesDir = $app.dataDir() + '/storage'
    const evApiUrlRaw = $secrets.get('EVOLUTION_API_URL') || ''
    const evApiUrl = evApiUrlRaw.endsWith('/') ? evApiUrlRaw.slice(0, -1) : evApiUrlRaw
    const evApiKey = $secrets.get('EVOLUTION_API_KEY') || ''
    const touchedRemoteJids = {}

    let processedCount = 0

    for (let i = 0; i < candidateAudios.length; i++) {
      if (processedCount >= 5) break // Processa no máximo 5 por minuto para não sobrecarregar

      const msg = candidateAudios[i]
      const remoteJid = msg.getString('remote_jid') || ''
      const instanceName = msg.getString('instance_name') || ''
      const accountId = msg.getString('account_id') || ''
      const msgTimestamp = msg.getInt('timestamp') || 0

      // ─── REGRA DE ELEGIBILIDADE 1: Idade da mensagem (> 7 dias) ───
      // Se a mensagem for mais antiga que 7 dias, não transcrever retroativamente
      if (msgTimestamp > 0 && msgTimestamp < sevenDaysAgoSec) {
        msg.set('transcription', 'SKIP_NO_TRANSCRIBE')
        try {
          $app.save(msg)
        } catch (_) {}
        continue
      }

      // ─── REGRA DE ELEGIBILIDADE 2: Contato no estágio "cliente" ───
      // Áudio antigo de cliente não muda conduta
      let contact = null
      if (remoteJid && instanceName) {
        try {
          contact = $app.findFirstRecordByFilter(
            'crm_contacts',
            'instance_name = {:inst} && jid = {:jid}',
            { inst: instanceName, jid: remoteJid },
          )
        } catch (_) {}
      }

      if (contact && contact.getString('stage') === 'cliente') {
        msg.set('transcription', 'SKIP_NO_TRANSCRIBE')
        try {
          $app.save(msg)
        } catch (_) {}
        continue
      }

      // ─── REGRA DE ELEGIBILIDADE 3: Conversa arquivada ou sem movimentação há > 7 dias ───
      let conv = null
      if (remoteJid && instanceName) {
        try {
          conv = $app.findFirstRecordByFilter(
            'conversations',
            'instance_name = {:inst} && remote_jid = {:jid}',
            { inst: instanceName, jid: remoteJid },
          )
        } catch (_) {}
      }

      if (conv) {
        if (conv.getBool('archived')) {
          msg.set('transcription', 'SKIP_NO_TRANSCRIBE')
          try {
            $app.save(msg)
          } catch (_) {}
          continue
        }
        const lastConvTs = conv.getInt('last_message_timestamp') || 0
        if (lastConvTs > 0 && lastConvTs < sevenDaysAgoSec) {
          msg.set('transcription', 'SKIP_NO_TRANSCRIBE')
          try {
            $app.save(msg)
          } catch (_) {}
          continue
        }
      }

      // ─── REGRA 4: Teto diário de transcrições ───
      if (!canTranscribe(accountId)) {
        console.log(
          '[transcribe_audio_queue] Pausa automática: teto diário de transcrições atingido para conta ' +
            accountId,
        )
        break // Interrompe o loop do cron
      }

      const mediaFile = msg.getString('media_file')
      const mediaUrl = msg.getString('media_url')
      const messageId = msg.getString('message_id')
      let fileUrl = mediaUrl
      if (!fileUrl && mediaFile) {
        fileUrl = `${$app.baseUrl()}/api/files/whatsapp_messages/${msg.id}/${mediaFile}`
      }

      // 1. Tenta obter arquivo do storage via filesystem
      let audioFileObj = null
      if (mediaFile) {
        try {
          const localPath = baseFilesDir + '/' + msg.baseFilesPath() + '/' + mediaFile
          audioFileObj = $filesystem.fileFromPath(localPath)
        } catch (errLocal) {
          console.log(
            '[transcribe_audio_queue] fileFromPath erro para msg ' + msg.id + ':',
            errLocal,
          )
        }
      }

      // 2. Se fileFromPath falhou, tenta $http.send GET no PocketBase files endpoint
      if (!audioFileObj && fileUrl) {
        try {
          const superToken = $secrets.get('PB_SUPERUSER_TOKEN') || ''
          const dlHeaders = {}
          if (superToken) dlHeaders['Authorization'] = superToken
          const dlRes = $http.send({
            url: fileUrl,
            method: 'GET',
            headers: dlHeaders,
            timeout: 25,
          })
          if (
            dlRes.statusCode >= 200 &&
            dlRes.statusCode < 300 &&
            dlRes.body &&
            dlRes.body.length > 0
          ) {
            audioFileObj = $filesystem.fileFromBytes(dlRes.body, mediaFile || 'audio.ogg')
          }
        } catch (errHttpDl) {
          console.log(
            '[transcribe_audio_queue] $http.send download erro para msg ' + msg.id + ':',
            errHttpDl,
          )
        }
      }

      // 3. Fallback: Se não encontrou o arquivo no PB, tentar baixar da Evolution API
      if (!audioFileObj && evApiUrl && evApiKey && messageId && instanceName) {
        try {
          const evRes = $http.send({
            url: evApiUrl + '/chat/getBase64FromMediaMessage/' + instanceName,
            method: 'POST',
            headers: { 'Content-Type': 'application/json', apikey: evApiKey },
            body: JSON.stringify({
              message: {
                key: {
                  id: messageId,
                  remoteJid: msg.getString('remote_jid'),
                  fromMe: msg.getBool('from_me'),
                },
              },
              convertToMp4: false,
            }),
            timeout: 30,
          })

          if (evRes.statusCode === 200 && evRes.json && evRes.json.base64) {
            let b64 = evRes.json.base64
            if (b64.indexOf(',') !== -1) b64 = b64.split(',')[1]
            const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
            const lookup = new Uint8Array(256)
            for (let li = 0; li < chars.length; li++) lookup[chars.charCodeAt(li)] = li
            let bufferLength = b64.length * 0.75
            if (b64[b64.length - 1] === '=') bufferLength--
            if (b64[b64.length - 2] === '=') bufferLength--
            const bytes = new Uint8Array(bufferLength)
            let p = 0
            for (let bi = 0; bi < b64.length; bi += 4) {
              const enc1 = lookup[b64.charCodeAt(bi)]
              const enc2 = lookup[b64.charCodeAt(bi + 1)]
              const enc3 = lookup[b64.charCodeAt(bi + 2)]
              const enc4 = lookup[b64.charCodeAt(bi + 3)]
              bytes[p++] = (enc1 << 2) | (enc2 >> 4)
              if (p < bufferLength) bytes[p++] = ((enc2 & 15) << 4) | (enc3 >> 2)
              if (p < bufferLength) bytes[p++] = ((enc3 & 3) << 6) | (enc4 & 63)
            }
            audioFileObj = $filesystem.fileFromBytes(bytes, 'audio.ogg')
          }
        } catch (evDlErr) {
          console.log('[transcribe_audio_queue] Evolution API download erro:', evDlErr)
        }
      }

      if (!audioFileObj) {
        console.log(
          '[transcribe_audio_queue] Áudio não encontrado localmente nem via URL para msg ' + msg.id,
        )
        continue
      }

      try {
        console.log(
          '[transcribe_audio_queue] Enviando áudio elegível da msg ' +
            msg.id +
            ' para Whisper OpenAI...',
        )
        const formData = new FormData()
        formData.append('model', 'whisper-1')
        formData.append('language', 'pt')
        formData.append('file', audioFileObj)

        const whisperRes = $http.send({
          url: 'https://api.openai.com/v1/audio/transcriptions',
          method: 'POST',
          headers: {
            Authorization: 'Bearer ' + openAiKey,
          },
          body: formData,
          timeout: 60,
        })

        if (whisperRes.statusCode >= 200 && whisperRes.statusCode < 300) {
          const text = (whisperRes.json && whisperRes.json.text) || ''
          if (text && text.trim()) {
            const cleanText = text.trim()
            msg.set('transcription', cleanText)
            $app.save(msg)
            recordTranscription(accountId)
            processedCount++
            console.log(
              '[transcribe_audio_queue] ✅ Mensagem ' +
                msg.id +
                ' transcrita com sucesso: "' +
                cleanText.substring(0, 80) +
                '..."',
            )

            const rJid = msg.getString('remote_jid')
            const inst = msg.getString('instance_name')
            if (rJid && inst) {
              touchedRemoteJids[inst + '___' + rJid] = {
                instanceName: inst,
                remoteJid: rJid,
                accountId: accountId,
              }
            }
          } else {
            console.log('[transcribe_audio_queue] Whisper retornou texto vazio para msg ' + msg.id)
          }
        } else {
          console.log(
            '[transcribe_audio_queue] ❌ Whisper erro HTTP ' +
              whisperRes.statusCode +
              ' para msg ' +
              msg.id +
              ': ' +
              JSON.stringify(whisperRes.json || {}),
          )
        }
      } catch (err) {
        $app.logger().warn('transcribe_audio_queue error', 'msg_id', msg.id, 'error', String(err))
        console.log('[transcribe_audio_queue] Exceção ao transcrever msg ' + msg.id + ':', err)
      }
    }

    // ─── RECLASSIFICAÇÃO CONSOLIDADA COM COOLDOWN DE 6 HORAS ───
    const touchedKeys = Object.keys(touchedRemoteJids)
    for (let k = 0; k < touchedKeys.length; k++) {
      const { instanceName, remoteJid, accountId } = touchedRemoteJids[touchedKeys[k]]
      if (!remoteJid || remoteJid.endsWith('@g.us') || remoteJid === 'status@broadcast') {
        continue
      }

      let contact = null
      try {
        contact = $app.findFirstRecordByFilter(
          'crm_contacts',
          'instance_name = {:inst} && jid = {:jid}',
          { inst: instanceName, jid: remoteJid },
        )
      } catch (_) {}

      if (!contact) continue

      // Não reclassificar se o contato já for cliente
      if (contact.getString('stage') === 'cliente') {
        continue
      }

      // COOLDOWN DE 6 HORAS: verificar campo last_ai_reclassified_at
      const lastReclassifiedStr = contact.getString('last_ai_reclassified_at')
      if (lastReclassifiedStr) {
        const lastReclassifiedTime = new Date(lastReclassifiedStr).getTime()
        const sixHoursMs = 6 * 3600 * 1000
        if (!isNaN(lastReclassifiedTime) && Date.now() - lastReclassifiedTime < sixHoursMs) {
          const waitMins = Math.round((sixHoursMs - (Date.now() - lastReclassifiedTime)) / 60000)
          console.log(
            '[transcribe_audio_queue] Cooldown ativo (6h) para contato ' +
              remoteJid +
              '. Próxima reclassificação liberada em ' +
              waitMins +
              ' min.',
          )
          continue
        }
      }

      // TETO DIÁRIO de análises IA
      if (!canAnalyzeAi(accountId)) {
        console.log(
          '[transcribe_audio_queue] Pausa automática: teto diário de análises IA atingido para conta ' +
            accountId,
        )
        break
      }

      try {
        console.log(
          '[transcribe_audio_queue] Disparando reclassificação IA retroativa para contato: ' +
            remoteJid,
        )

        // PROMPT ENXUTO: reduzir o contexto de 15 para 8 mensagens recentes
        // E cortar cada transcrição a ~200 caracteres (~40% menos tokens)
        let messages = []
        try {
          messages = $app.findRecordsByFilter(
            'whatsapp_messages',
            'remote_jid = {:jid} && instance_name = {:inst}',
            '-timestamp',
            8,
            0,
            { jid: remoteJid, inst: instanceName },
          )
        } catch (_) {}

        if (!messages || messages.length === 0) continue

        const formatMsg = (m) => {
          const content = m.getString('content')
          if (content && content.trim()) {
            return content.trim().length > 300
              ? content.trim().substring(0, 300) + '…'
              : content.trim()
          }
          const transcription = m.getString('transcription')
          if (transcription && transcription.trim() && transcription !== 'SKIP_NO_TRANSCRIBE') {
            const cut = transcription.trim()
            return (
              '[áudio transcrito: ' + (cut.length > 200 ? cut.substring(0, 200) + '…' : cut) + ']'
            )
          }
          const msgType = m.getString('message_type') || ''
          if (msgType === 'audioMessage' || msgType === 'audio' || msgType === 'ptt') {
            return '[áudio de voz]'
          }
          return '[mídia]'
        }

        const transcript = messages
          .slice()
          .reverse()
          .map((m) => {
            const from = m.getBool('from_me') ? 'Atendente' : m.getString('push_name') || 'Cliente'
            return from + ': ' + formatMsg(m)
          })
          .join('\n')

        const contactName =
          contact.getString('contact_name') || contact.getString('push_name') || remoteJid

        let rulesDesc = 'Consulta inicial (7d), Retorno de SOP (15d), Procedimento hormonal (5d)'
        try {
          const rules = $app.findRecordsByFilter(
            'care_followup_rules',
            'id != ""',
            'created',
            50,
            0,
          )
          const lines = []
          for (let r = 0; r < rules.length; r++) {
            const nm = rules[r].getString('name')
            const ds = rules[r].getInt('followup_days') || 10
            if (nm) lines.push(nm + ' (' + ds + 'd)')
          }
          if (lines.length > 0) rulesDesc = lines.join(', ')
        } catch (_) {}

        const pStage = contact.getString('stage') || 'lead'
        const pCare = contact.getString('care_status') || 'em_dia'
        let activeTasksCount = 0
        try {
          const tks = $app.findRecordsByFilter(
            'tasks',
            "crm_contact_id = {:cid} && status != 'concluida' && status != 'cancelada'",
            '-created',
            5,
            0,
            { cid: contact.id },
          )
          activeTasksCount = tks ? tks.length : 0
        } catch (_) {}

        const systemPromptCare =
          'Você é o assistente de CRM e inteligência clínica do Dr. Caio Cândido (nutricionista).\n' +
          'Papéis: "Dr. Caio" é o nutricionista; "Fabiana" é a assistente/secretária de agendamento. NUNCA interpretá-los como pacientes.\n' +
          'Regras de Follow-up: ' +
          rulesDesc +
          '.\n' +
          'Vocabulário: SOP, plano alimentar, retorno, bioimpedância, tireoide, resistência insulínica.\n' +
          'Responda APENAS em JSON com:\n' +
          'stage (lead | em_atendimento | cliente | nao_respondido),\n' +
          'role (paciente | nao_paciente),\n' +
          'is_patient (boolean: true se agendou/fez consulta),\n' +
          'conversion_detected (boolean: true se fechou consulta),\n' +
          'suggested_action (próxima ação clínica, max 100 chars),\n' +
          'priority (número de 1 a 10).'

        const userPromptCare =
          'Paciente: ' +
          contactName +
          ' | Stage: ' +
          pStage +
          ' | Care: ' +
          pCare +
          ' | Tarefas ativas: ' +
          activeTasksCount +
          '\n\nHistórico (8 msgs):\n' +
          transcript

        const reply = $ai.chat({
          model: 'fast',
          messages: [
            { role: 'system', content: systemPromptCare },
            { role: 'user', content: userPromptCare },
          ],
        })

        recordAiAnalysis(accountId)

        const rawText =
          reply.choices &&
          reply.choices[0] &&
          reply.choices[0].message &&
          reply.choices[0].message.content

        if (rawText) {
          const jsonMatch = rawText.match(/\{[\s\S]*\}/)
          if (jsonMatch) {
            const aiResult = JSON.parse(jsonMatch[0])
            const validStages = ['lead', 'em_atendimento', 'cliente', 'nao_respondido']
            if (aiResult.stage && validStages.indexOf(aiResult.stage) >= 0) {
              contact.set('stage', aiResult.stage)
            }
            if (aiResult.role === 'paciente' || aiResult.role === 'nao_paciente') {
              contact.set('role', aiResult.role)
            }
            const conversionDetected = aiResult.conversion_detected === true
            const isPatient = aiResult.is_patient === true

            if (conversionDetected || isPatient) {
              if (!contact.getBool('is_patient')) contact.set('is_patient', true)
              if (!contact.getString('converted_at')) {
                contact.set('converted_at', new Date().toISOString().split('T')[0])
              }
              if (conversionDetected) contact.set('stage', 'cliente')
            }

            if (aiResult.suggested_action) {
              contact.set(
                'ai_suggested_action',
                String(aiResult.suggested_action).substring(0, 500),
              )
            }
            if (aiResult.priority !== undefined) {
              const priority = Number(aiResult.priority)
              if (Number.isFinite(priority)) {
                contact.set('ai_priority', Math.min(Math.max(priority, 1), 10))
              }
            }

            const nowIso = new Date().toISOString().replace('T', ' ')
            contact.set('last_ai_reclassified_at', nowIso)
            contact.set('last_synced_at', nowIso)
            $app.saveNoValidate(contact)
            console.log(
              '[transcribe_audio_queue] ✅ Reclassificação retroativa concluída para ' +
                contactName +
                ' (stage: ' +
                contact.getString('stage') +
                ', cooldown 6h registrado)',
            )
          }
        }
      } catch (errReclass) {
        console.log(
          '[transcribe_audio_queue] Erro na reclassificação retroativa de ' + remoteJid + ':',
          errReclass,
        )
      }
    }
  } catch (e) {
    $app.logger().warn('transcribe_audio_queue run error', 'error', String(e))
    console.log('[transcribe_audio_queue] Falha geral no cron:', e)
  }
})
