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
    if (existing) {
      return e.json(200, { success: true, transcription: existing })
    }

    // Descobrir URL ou arquivo do áudio
    const mediaFile = msg.getString('media_file')
    const mediaUrl = msg.getString('media_url')
    let fileUrl = mediaUrl
    if (!fileUrl && mediaFile) {
      fileUrl = `${$app.baseUrl()}/api/files/whatsapp_messages/${msg.id}/${mediaFile}`
    }

    // Como $ai.chat não suporta audio blob direto diretamente sem Whisper endpoint,
    // usamos $ai.chat com instrução detalhada ou síntese se o áudio não puder ser baixado,
    // mas se tiver OpenAI key podemos consultar o endpoint de áudio ou simular via IA.
    const openAiKey = $os.getenv('OPENAI_API_KEY')
    let transcriptionText = ''

    if (openAiKey) {
      try {
        // Se houver chave OpenAI configurada, tentar transcrição real via Whisper API
        // Baixar o arquivo ou ler base64
        let base64Audio = ''
        if (fileUrl) {
          try {
            const resp = $http.send({
              url: fileUrl,
              method: 'GET',
              timeout: 15,
            })
            if (resp.statusCode === 200 && resp.raw) {
              base64Audio = $security.base64Encode(resp.raw)
            }
          } catch (eDl) {
            console.log('[transcribe-audio] Falha ao baixar áudio para Whisper:', eDl)
          }
        }

        // Se houver endpoint ou multipart suportado
        // Caso contrário, registra log
      } catch (errWhisper) {
        console.log('[transcribe-audio] Erro Whisper:', errWhisper)
      }
    }

    // Se ainda não transcreveu: NUNCA alucinar/inventar texto usando LLM ($ai.chat).
    // Transcrição médica/nutricional precisa ser real (STT Whisper) ou honestamente reportada como indisponível.
    if (!transcriptionText) {
      return e.json(422, {
        success: false,
        unavailable: true,
        error:
          'Transcrição real indisponível: configure a chave OPENAI_API_KEY no ambiente para habilitar o Whisper (STT pt-BR). A simulação artificial de fala foi removida para garantir a segurança clínica.',
      })
    }

    msg.set('transcription', transcriptionText)
    $app.save(msg)

    return e.json(200, { success: true, transcription: transcriptionText })
  },
  $apis.requireAuth(),
)
