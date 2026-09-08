// Cron para processamento da fila de transcrição de áudios
// Executa a cada minuto buscando mensagens de áudio sem transcrição
cronAdd('transcribe_audio_queue', '* * * * *', () => {
  const openAiKey = $os.getenv('OPENAI_API_KEY')

  // Se não há credencial de STT real configurada, a fila não inventa transcrição
  if (!openAiKey) {
    return
  }

  try {
    // Busca até 5 áudios recentes que ainda não foram transcritos
    const pendingAudios = $app.findRecordsByFilter(
      'whatsapp_messages',
      "message_type = 'audioMessage' && (transcription = '' || transcription IS NULL)",
      '-created',
      5,
      0,
    )

    if (!pendingAudios || pendingAudios.length === 0) {
      return
    }

    for (let i = 0; i < pendingAudios.length; i++) {
      const msg = pendingAudios[i]
      const mediaFile = msg.getString('media_file')
      const mediaUrl = msg.getString('media_url')
      let fileUrl = mediaUrl
      if (!fileUrl && mediaFile) {
        fileUrl = `${$app.baseUrl()}/api/files/whatsapp_messages/${msg.id}/${mediaFile}`
      }

      if (!fileUrl) continue

      try {
        // Quando a chave OpenAI estiver configurada e houver arquivo acessível
        // Poderá processar via Whisper
      } catch (err) {
        $app.logger().warn('transcribe_audio_queue error', 'msg_id', msg.id, 'error', String(err))
      }
    }
  } catch (e) {
    $app.logger().warn('transcribe_audio_queue run error', 'error', String(e))
  }
})
