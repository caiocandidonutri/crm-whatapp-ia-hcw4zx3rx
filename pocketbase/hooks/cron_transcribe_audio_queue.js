// Cron para processamento da fila de transcrição de áudios
// Executa a cada minuto buscando mensagens de áudio sem transcrição
cronAdd('transcribe_audio_queue', '* * * * *', () => {
  const openAiKey = $secrets.get('OPENAI_API_KEY') || $os.getenv('OPENAI_API_KEY')

  // Se não há credencial de STT real configurada, a fila não inventa transcrição
  if (!openAiKey) {
    console.log('[transcribe_audio_queue] Pulando: OPENAI_API_KEY não encontrada em secrets/env.')
    return
  }

  try {
    // Busca até 5 áudios que ainda não foram transcritos (priorizando mais antigos para fila retroativa constante)
    // No PocketBase filter: transcription = '' cobre vazio/nulo
    const pendingAudios = $app.findRecordsByFilter(
      'whatsapp_messages',
      "(message_type = 'audioMessage' || message_type = 'audio' || message_type = 'ptt' || media_file ~ '.ogg' || media_filename ~ '.ogg') && transcription = '' && media_file != ''",
      '+created',
      5,
      0,
    )

    if (!pendingAudios || pendingAudios.length === 0) {
      return
    }

    console.log(
      '[transcribe_audio_queue] Encontrados ' +
        pendingAudios.length +
        ' áudio(s) pendentes para transcrição.',
    )

    const baseFilesDir = $app.dataDir() + '/storage'
    const evApiUrlRaw = $secrets.get('EVOLUTION_API_URL') || ''
    const evApiUrl = evApiUrlRaw.endsWith('/') ? evApiUrlRaw.slice(0, -1) : evApiUrlRaw
    const evApiKey = $secrets.get('EVOLUTION_API_KEY') || ''
    const touchedRemoteJids = {}

    for (let i = 0; i < pendingAudios.length; i++) {
      const msg = pendingAudios[i]
      const mediaFile = msg.getString('media_file')
      const mediaUrl = msg.getString('media_url')
      const messageId = msg.getString('message_id')
      const instanceName = msg.getString('instance_name')
      let fileUrl = mediaUrl
      if (!fileUrl && mediaFile) {
        fileUrl = `${$app.baseUrl()}/api/files/whatsapp_messages/${msg.id}/${mediaFile}`
      }

      // 1. Tenta obter arquivo do storage via filesystem ou URL
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

      // 2. Se fileFromPath falhou, tenta $http.send GET no PocketBase files endpoint com superuser token ou público
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

      // 3. Fallback: Se não encontrou o arquivo no PB, tentar baixar da Evolution API via getBase64FromMediaMessage
      if (!audioFileObj && evApiUrl && evApiKey && messageId && instanceName) {
        try {
          console.log(
            '[transcribe_audio_queue] Tentando Evolution API getBase64FromMediaMessage para msg ' +
              msg.id,
          )
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
          '[transcribe_audio_queue] Enviando áudio da msg ' + msg.id + ' para Whisper OpenAI...',
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
              touchedRemoteJids[inst + '___' + rJid] = { instanceName: inst, remoteJid: rJid }
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

    // 3. Reclassificação retroativa: após transcrever mensagens de uma conversa, disparar a reclassificação da IA para essa conversa
    const touchedKeys = Object.keys(touchedRemoteJids)
    for (let k = 0; k < touchedKeys.length; k++) {
      const { instanceName, remoteJid } = touchedRemoteJids[touchedKeys[k]]
      if (!remoteJid || remoteJid.endsWith('@g.us') || remoteJid === 'status@broadcast') {
        continue
      }

      try {
        console.log(
          '[transcribe_audio_queue] Disparando reclassificação IA retroativa para contato: ' +
            remoteJid,
        )
        let contact = null
        try {
          contact = $app.findFirstRecordByFilter(
            'crm_contacts',
            'instance_name = {:inst} && jid = {:jid}',
            { inst: instanceName, jid: remoteJid },
          )
        } catch (_) {}

        if (!contact) continue

        // Buscar até 15 mensagens recentes da conversa (agora com as transcrições atualizadas)
        let messages = []
        try {
          messages = $app.findRecordsByFilter(
            'whatsapp_messages',
            'remote_jid = {:jid} && instance_name = {:inst}',
            '-timestamp',
            15,
            0,
            { jid: remoteJid, inst: instanceName },
          )
        } catch (_) {}

        if (!messages || messages.length === 0) continue

        const formatMsg = (m) => {
          const content = m.getString('content')
          if (content && content.trim()) return content.trim()
          const transcription = m.getString('transcription')
          if (transcription && transcription.trim()) {
            return '[áudio transcrito: ' + transcription.trim() + ']'
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
          'Você é o assistente de inteligência clínica e CRM da clínica de nutrição do Dr. Caio Cândido.\n' +
          'Papéis fundamentais da clínica:\n' +
          '- "Dr. Caio" / "Dr. Caio Cândido" é o nutricionista responsável pelas consultas e condutas nutricionais.\n' +
          '- "Fabiana" é a assistente/secretária de acolhimento e agendamento.\n' +
          '- Dr. Caio e Fabiana NUNCA devem ser interpretados como pacientes. O paciente é o interlocutor externo na conversa.\n' +
          'Regras de Follow-up lidas da clínica: ' +
          rulesDesc +
          '.\n' +
          'Vocabulário nutricional/clínico relevante: SOP (Síndrome dos Ovários Policísticos), plano alimentar, retorno, bioimpedância, tireoide, resistência insulínica, sintomas e exames.\n\n' +
          'Responda APENAS em JSON válido com os campos:\n' +
          'stage (um de: lead, em_atendimento, cliente, nao_respondido),\n' +
          'role (um de: paciente, nao_paciente),\n' +
          'is_patient (boolean: true se é paciente ou agendou consulta com Dr. Caio),\n' +
          'conversion_detected (boolean: true se detectou agendamento/confirmação/fechamento de consulta),\n' +
          'suggested_action (próxima ação clínica/atendimento sugerida, max 120 chars),\n' +
          'priority (número de 1 a 10, onde 10 é mais urgente).'

        const userPromptCare =
          'Paciente/Contato: ' +
          contactName +
          '\n' +
          'Estágio do pipeline (stage): ' +
          pStage +
          '\n' +
          'Status de cuidado (care_status): ' +
          pCare +
          '\n' +
          'Tarefas de cuidado ativas: ' +
          activeTasksCount +
          '\n\n' +
          'Histórico da Conversa (com áudios transcritos):\n' +
          transcript

        const reply = $ai.chat({
          model: 'fast',
          messages: [
            { role: 'system', content: systemPromptCare },
            { role: 'user', content: userPromptCare },
          ],
        })

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

            contact.set('last_synced_at', new Date().toISOString().replace('T', ' '))
            $app.saveNoValidate(contact)
            console.log(
              '[transcribe_audio_queue] ✅ Reclassificação retroativa concluída para ' +
                contactName +
                ' (stage: ' +
                contact.getString('stage') +
                ')',
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
