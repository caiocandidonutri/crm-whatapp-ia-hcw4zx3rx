routerAdd(
  'POST',
  '/backend/v1/crm-care/chat',
  async (e) => {
    try {
      var body = e.requestInfo().body || {}
      var userId = e.auth && e.auth.id
      if (!userId) return e.unauthorizedError('auth required')
      if (!body.message || !String(body.message).trim()) {
        return e.badRequestError('message is required')
      }

      var secretaryMessages = []
      try {
        secretaryMessages = $app.findRecordsByFilter(
          'whatsapp_messages',
          'from_me = true',
          '-timestamp',
          20,
          0,
        )
      } catch (_) {}

      var toneExamples = ''
      for (var i = 0; i < secretaryMessages.length; i++) {
        var content = secretaryMessages[i].getString('content')
        if (content && content.length > 5) {
          toneExamples += content + '\n'
        }
      }

      var finalMessage = String(body.message)
      if (toneExamples) {
        finalMessage =
          '[EXEMPLOS DO TOM DA SECRETÁRIA — replique este estilo nas suas respostas]\n' +
          toneExamples +
          '\n\n[MENSAGEM DO USUÁRIO]\n' +
          finalMessage
      }

      var conv
      try {
        conv = $ai.agent('crm-care-agent').getOrCreateConversation({
          user_id: userId,
          id: body.conversation_id || null,
        })
      } catch (err) {
        if (err instanceof SkipAiConfigError) {
          return e.json(503, { error: 'AI temporariamente indisponível' })
        }
        if (err instanceof SkipAiAgentsError) {
          var agentStatus = err.status || 500
          return e.json(agentStatus, {
            error: agentStatus >= 500 ? 'Erro no agente' : err.message,
          })
        }
        throw err
      }

      var iter = $ai.agent('crm-care-agent').chat({
        user_id: userId,
        conversation_id: conv.id,
        message: finalMessage,
        stream: true,
      })

      e.response.header().set('Content-Type', 'text/event-stream')
      e.response.header().set('Cache-Control', 'no-cache')
      e.response.header().set('X-Conversation-Id', conv.id)

      await $response.stream(e, iter)
    } catch (err) {
      if (err instanceof SkipAiConfigError) {
        return e.json(503, { error: 'AI temporariamente indisponível' })
      }
      if (err instanceof SkipAiAgentsError) {
        var s1 = err.status || 500
        return e.json(s1, { error: s1 >= 500 ? 'Erro no agente' : err.message })
      }
      if (err instanceof SkipAiError) {
        var s2 = err.status || 502
        return e.json(s2, { error: s2 >= 500 ? 'AI temporariamente indisponível' : err.message })
      }
      $app.logger().error('crm-care-chat error', 'error', String(err))
      return e.json(500, { error: 'Erro interno' })
    }
  },
  $apis.requireAuth(),
)
