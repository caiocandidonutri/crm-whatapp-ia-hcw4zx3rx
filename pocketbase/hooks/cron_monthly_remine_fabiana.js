/// <reference path="../pb_data/types.d.ts" />

// FRENTE 3: Atualização mensal da essência da Fabiana IA ("reminerar conversas novas")
// Executa no dia 1º de cada mês às 03:00 da madrugada: '0 3 1 * *'
// Busca mensagens da Fabiana humana dos últimos ~30 dias, extrai padrões novos de tom de voz,
// saudações, emojis e frases marcantes, e atualiza o prompt do agente 'fabiana-ia' APENAS
// nas seções de tom de voz/vocabulário — PRESERVANDO TODAS as regras invioláveis de segurança e ritmo.

// REATIVAÇÃO MENSAL FABIANA (Executa dia 1 de cada mês às 04:53 UTC = 01:53 Brasília)
// Restaurado da emergência com horário escalonado
cronAdd('monthly_remine_fabiana', '53 4 1 * *', () => {
  $app.logger().info('[cron_monthly_remine_fabiana] Iniciando remineração mensal de essência...')

  try {
    // 1. Mensagens dos últimos 30 dias enviadas pela Fabiana humana
    // Filtro: from_me = true, content != '', push_name contendo Fabiana ou não sendo robô genérico
    // Calculando timestamp aproximado de 30 dias atrás (30 * 86400 * 1000 = 2592000000 ms)
    var thirtyDaysAgoMs = Date.now() - 30 * 24 * 60 * 60 * 1000

    var candidateMessages = []
    try {
      // Buscar até 100 mensagens recentes da Fabiana humana
      var records = $app.findRecordsByFilter(
        'whatsapp_messages',
        'from_me = true && timestamp >= {:since}',
        '-timestamp',
        100,
        0,
        { since: thirtyDaysAgoMs },
      )

      for (var i = 0; i < records.length; i++) {
        var rec = records[i]
        var pName = (
          rec.getString('push_name') ||
          rec.getString('participant_pushname') ||
          ''
        ).toLowerCase()
        var content = (rec.getString('content') || '').trim()

        // Excluir vazias, áudios não transcritos, mensagens automáticas de sistema
        if (
          !content ||
          content.startsWith('[audio') ||
          content.startsWith('[Áudio') ||
          content.length < 5
        ) {
          continue
        }
        // Excluir se o nome do remetente for expressamente "assistente" puro sem ser Fabiana
        if (pName === 'assistente' && pName.indexOf('fabiana') === -1) {
          continue
        }

        candidateMessages.push(content)
      }
    } catch (dbErr) {
      $app
        .logger()
        .error('[cron_monthly_remine_fabiana] Erro ao buscar mensagens', 'error', String(dbErr))
    }

    $app
      .logger()
      .info(
        '[cron_monthly_remine_fabiana] Mensagens humanas coletadas para análise: ' +
          candidateMessages.length,
      )

    if (candidateMessages.length < 5) {
      $app
        .logger()
        .info(
          '[cron_monthly_remine_fabiana] Amostra insuficiente de mensagens nos últimos 30 dias (< 5). Mantendo prompt atual sem alterações.',
        )
      return
    }

    // 2. Destilar novas frases e nuances com o LLM Skip Cloud ($ai.chat alias 'fast')
    var sampleText = candidateMessages.slice(0, 40).join('\n---\n')
    var aiAnalysisPrompt =
      'Você é um linguista e especialista em tom de voz. Analise as seguintes mensagens enviadas no WhatsApp pela secretária Fabiana da clínica nutricional nos últimos 30 dias:\n\n' +
      sampleText +
      '\n\n' +
      'Extraia um resumo curto (máximo 8 linhas) com:\n' +
      '- Novas saudações e despedidas mais frequentes usadas pela Fabiana\n' +
      '- Expressões acolhedoras ou mineiras marcantes observadas\n' +
      '- Emojis mais recorrentes\n' +
      'Responda em tópicos diretos e objetivos em Português.'

    var aiReply = null
    try {
      aiReply = $ai.chat({
        model: 'fast',
        messages: [
          { role: 'system', content: 'Você analisa padrões reais de escrita e tom de voz.' },
          { role: 'user', content: aiAnalysisPrompt },
        ],
      })
    } catch (aiErr) {
      $app
        .logger()
        .error(
          '[cron_monthly_remine_fabiana] Erro no $ai.chat ao analisar mensagens',
          'error',
          String(aiErr),
        )
      return
    }

    var distilledNotes =
      aiReply &&
      aiReply.choices &&
      aiReply.choices[0] &&
      aiReply.choices[0].message &&
      aiReply.choices[0].message.content
        ? aiReply.choices[0].message.content.trim()
        : ''

    if (!distilledNotes) {
      $app
        .logger()
        .warn('[cron_monthly_remine_fabiana] Nenhuma nota destilada retornada pelo modelo.')
      return
    }

    $app
      .logger()
      .info('[cron_monthly_remine_fabiana] Notas destiladas da essência:\n' + distilledNotes)

    // 3. Atualizar o prompt nos registros da coleção ai_agents (preservando documentos e seções invioláveis)
    // Localiza os agentes "Fabiana IA"
    var fabianaAgents = $app.findRecordsByFilter('ai_agents', 'name = {:name}', 'created', 50, 0, {
      name: 'Fabiana IA',
    })

    var updatedCount = 0
    var dateLabel = new Date().toLocaleDateString('pt-BR')

    for (var a = 0; a < fabianaAgents.length; a++) {
      var agentRec = fabianaAgents[a]
      var currentPrompt = agentRec.getString('system_prompt') || ''

      // Se já houver um bloco de "ATUALIZAÇÃO MENSAL DE ESSÊNCIA", substitui; senão, adiciona dentro da Seção 2 ou ao final de tom de voz
      var markerStart = '\n\n[ATUALIZAÇÃO DE ESSÊNCIA MENSAL - MINEIRIDADE E VOCABULÁRIO RECENTE]'
      var markerEnd = '[FIM DA ATUALIZAÇÃO DE ESSÊNCIA]'

      var essenceBlock =
        markerStart +
        '\n(Atualizado em ' +
        dateLabel +
        ' com base em mensagens reais recentes da Fabiana):\n' +
        distilledNotes +
        '\n' +
        markerEnd

      var newPrompt = currentPrompt
      if (newPrompt.indexOf(markerStart) !== -1) {
        var pre = newPrompt.substring(0, newPrompt.indexOf(markerStart))
        var postIdx = newPrompt.indexOf(markerEnd)
        var post = postIdx !== -1 ? newPrompt.substring(postIdx + markerEnd.length) : ''
        newPrompt = pre + essenceBlock + post
      } else {
        // Encaixa logo após a Seção 2 ou ao final
        var sec3Idx = newPrompt.indexOf(
          '═══════════════════════════════════════════════════════════════════\n3. POLÍTICA DE CIDADES',
        )
        if (sec3Idx !== -1) {
          newPrompt =
            newPrompt.substring(0, sec3Idx) + essenceBlock + '\n\n' + newPrompt.substring(sec3Idx)
        } else {
          newPrompt += '\n\n' + essenceBlock
        }
      }

      agentRec.set('system_prompt', newPrompt)
      // Campo "documents" NUNCA é tocado
      try {
        $app.save(agentRec)
        updatedCount++
      } catch (saveErr) {
        $app
          .logger()
          .error(
            '[cron_monthly_remine_fabiana] Erro ao salvar agente ' + agentRec.id,
            'error',
            String(saveErr),
          )
      }
    }

    $app
      .logger()
      .info(
        '[cron_monthly_remine_fabiana] Sucesso: ' +
          updatedCount +
          ' contas/agentes atualizados com a essência refinada.',
      )
  } catch (globalErr) {
    $app
      .logger()
      .error('[cron_monthly_remine_fabiana] Erro inesperado na rotina', 'error', String(globalErr))
  }
})
