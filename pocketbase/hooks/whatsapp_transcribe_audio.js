routerAdd(
  'POST',
  '/backend/v1/whatsapp/transcribe-audio',
  (e) => {
    const body = e.requestInfo().body || {}
    const { messageId } = body

    if (!messageId) {
      throw new BadRequestError('Parâmetro ausente: messageId')
    }

    const userId = e.auth?.id
    if (!userId) {
      throw new UnauthorizedError('Não autorizado')
    }

    const msg = $app.findRecordById('whatsapp_messages', messageId)
    if (!msg) {
      throw new NotFoundError('Mensagem não encontrada')
    }

    // Se já tiver transcrição no banco, devolve direto
    const existing = msg.getString('transcription')
    if (existing && existing !== 'SKIP_NO_TRANSCRIBE') {
      return e.json(200, { success: true, transcription: existing })
    }

    // Descobrir URL ou arquivo do áudio
    const mediaFile = msg.getString('media_file')
    const mediaUrl = msg.getString('media_url')
    let fileUrl = mediaUrl
    if (!fileUrl && mediaFile) {
      fileUrl = `${$app.baseUrl()}/api/files/whatsapp_messages/${msg.id}/${mediaFile}`
    }

    const apiKey = $secrets.get('OPENAI_API_KEY') || $os.getenv('OPENAI_API_KEY')
    if (!apiKey) {
      return e.json(422, {
        success: false,
        unavailable: true,
        error:
          'Transcrição real indisponível: configure a chave OPENAI_API_KEY no ambiente para habilitar o Whisper (STT pt-BR).',
      })
    }

    // Obter arquivo de áudio
    let audioFileObj = null
    const baseFilesDir = $app.dataDir() + '/storage'
    if (mediaFile) {
      const localPath = baseFilesDir + '/' + msg.baseFilesPath() + '/' + mediaFile
      try {
        audioFileObj = $filesystem.fileFromPath(localPath)
      } catch (errLocal) {
        console.log('[transcribe-audio] fileFromPath falhou:', errLocal)
      }
    }

    if (!audioFileObj && fileUrl) {
      try {
        audioFileObj = $filesystem.fileFromURL(fileUrl, 30)
      } catch (errUrl) {
        console.log('[transcribe-audio] fileFromURL falhou:', errUrl)
      }
    }

    if (!audioFileObj) {
      return e.json(404, {
        success: false,
        error: 'Arquivo de áudio não encontrado localmente ou via URL para transcrição',
      })
    }

    let transcriptionText = ''
    try {
      const formData = new FormData()
      formData.append('model', 'whisper-1')
      formData.append('language', 'pt')
      formData.append('file', audioFileObj)

      const whisperRes = $http.send({
        url: 'https://api.openai.com/v1/audio/transcriptions',
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + apiKey,
        },
        body: formData,
        timeout: 60,
      })

      if (whisperRes.statusCode >= 200 && whisperRes.statusCode < 300) {
        transcriptionText = (whisperRes.json && whisperRes.json.text) || ''
      } else {
        console.log(
          '[transcribe-audio] Whisper erro HTTP',
          whisperRes.statusCode,
          JSON.stringify(whisperRes.json || {}),
        )
        return e.json(502, {
          success: false,
          error:
            'Falha no Whisper API (' +
            whisperRes.statusCode +
            '): ' +
            JSON.stringify(whisperRes.json || {}),
        })
      }
    } catch (whisperErr) {
      console.log('[transcribe-audio] Erro chamada Whisper:', whisperErr)
      return e.json(500, {
        success: false,
        error: 'Erro ao conectar à API Whisper: ' + String(whisperErr),
      })
    }

    if (!transcriptionText || !transcriptionText.trim()) {
      return e.json(422, {
        success: false,
        error: 'Whisper não retornou texto para o áudio.',
      })
    }

    transcriptionText = transcriptionText.trim()
    msg.set('transcription', transcriptionText)
    $app.save(msg)

    // Contabilizar no uso diário
    try {
      const accId = msg.getString('account_id')
      const d = new Date()
      const utc = d.getTime() + d.getTimezoneOffset() * 60000
      const spTime = new Date(utc - 3 * 3600000)
      const dayKey =
        spTime.getFullYear() +
        '-' +
        String(spTime.getMonth() + 1).padStart(2, '0') +
        '-' +
        String(spTime.getDate()).padStart(2, '0')
      const filter = accId
        ? "day_key = '" + dayKey + "' && account_id = '" + accId + "'"
        : "day_key = '" + dayKey + "'"
      let u = null
      try {
        u = $app.findFirstRecordByFilter('app_daily_usage', filter)
      } catch (_) {}
      if (!u) {
        const uCol = $app.findCollectionByNameOrId('app_daily_usage')
        u = new Record(uCol)
        u.set('day_key', dayKey)
        if (accId) u.set('account_id', accId)
        u.set('transcriptions_count', 0)
        u.set('transcriptions_limit', 150)
        u.set('ai_analyses_count', 0)
        u.set('ai_analyses_limit', 200)
      }
      u.set('transcriptions_count', (u.getInt('transcriptions_count') || 0) + 1)
      $app.save(u)
    } catch (_) {}

    console.log(
      '[transcribe-audio] Mensagem ' +
        messageId +
        ' transcrita com sucesso: "' +
        transcriptionText.substring(0, 60) +
        '..."',
    )

    return e.json(200, { success: true, transcription: transcriptionText })
  },
  $apis.requireAuth(),
)
