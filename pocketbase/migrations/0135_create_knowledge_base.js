migrate(
  (app) => {
    var accountsCol = app.findCollectionByNameOrId('accounts')
    var usersCol = app.findCollectionByNameOrId('users')

    // 1) Criar coleção knowledge_base
    try {
      app.findCollectionByNameOrId('knowledge_base')
    } catch (_) {
      var kbCol = new Collection({
        name: 'knowledge_base',
        type: 'base',
        listRule: '@request.auth.id != ""',
        viewRule: '@request.auth.id != ""',
        createRule: '@request.auth.id != ""',
        updateRule: '@request.auth.id != ""',
        deleteRule: '@request.auth.id != ""',
        fields: [
          {
            name: 'account_id',
            type: 'relation',
            collectionId: accountsCol.id,
            cascadeDelete: true,
            maxSelect: 1,
          },
          {
            name: 'categoria',
            type: 'select',
            required: true,
            maxSelect: 1,
            values: [
              'precos',
              'unidades_horarios',
              'suplementos',
              'orientacoes',
              'protocolos',
              'geral',
            ],
          },
          {
            name: 'titulo',
            type: 'text',
            required: true,
          },
          {
            name: 'pergunta',
            type: 'text',
          },
          {
            name: 'resposta',
            type: 'text',
            required: true,
          },
          {
            name: 'fonte',
            type: 'text',
          },
          {
            name: 'status',
            type: 'select',
            required: true,
            maxSelect: 1,
            values: ['proposta', 'aprovada', 'arquivada'],
          },
          {
            name: 'origem',
            type: 'select',
            required: true,
            maxSelect: 1,
            values: ['ia', 'humano'],
          },
          {
            name: 'approved_by',
            type: 'relation',
            collectionId: '_pb_users_auth_',
            cascadeDelete: false,
            maxSelect: 1,
          },
          {
            name: 'approved_at',
            type: 'date',
          },
        ],
        indexes: [
          'CREATE INDEX idx_kb_account ON knowledge_base (account_id)',
          'CREATE INDEX idx_kb_categoria ON knowledge_base (categoria)',
          'CREATE INDEX idx_kb_status ON knowledge_base (status)',
        ],
      })
      app.save(kbCol)
    }

    // 2) Adicionar campo plantao_fim_de_semana em care_alert_settings se não existir
    try {
      var careSettingsCol = app.findCollectionByNameOrId('care_alert_settings')
      var hasPlantaoField = false
      var fields = careSettingsCol.fields
      for (var f = 0; f < fields.length; f++) {
        if (fields[f].name === 'plantao_fim_de_semana') {
          hasPlantaoField = true
          break
        }
      }
      if (!hasPlantaoField) {
        careSettingsCol.fields.add(
          new BoolField({
            name: 'plantao_fim_de_semana',
          }),
        )
        app.save(careSettingsCol)
      }
    } catch (_) {}

    // 3) Seed das fichas de conhecimento reais da clínica (extraídas de áudios/mensagens reais)
    var accounts = []
    try {
      accounts = app.findRecordsByFilter('accounts', 'id != ""', 'created', 500, 0)
    } catch (_) {}

    var kbCollection = app.findCollectionByNameOrId('knowledge_base')

    var seedCards = [
      {
        categoria: 'precos',
        titulo: 'Valor da Consulta Tradicional com Retorno',
        pergunta: 'Quanto custa a consulta com o Dr. Caio?',
        resposta:
          'A consulta tradicional com retorno está ao valor de R$ 500,00. Inclui avaliação nutricional completa, bioimpedância na unidade e retorno já incluso no plano.',
        fonte:
          'Transcrição de áudio da Fabiana com paciente (remote_jid: 553598030301@s.whatsapp.net)',
        status: 'aprovada',
        origem: 'ia',
      },
      {
        categoria: 'unidades_horarios',
        titulo: 'Dias de Atendimento em Alfenas',
        pergunta: 'Quais dias o doutor atende em Alfenas?',
        resposta:
          'O doutor está atendendo em Alfenas nas terças-feiras e na sexta-feira. Os atendimentos são com horário marcado com a Fabiana.',
        fonte: 'Transcrição de áudio interno da Fabiana (remote_jid: 553598030301@s.whatsapp.net)',
        status: 'aprovada',
        origem: 'ia',
      },
      {
        categoria: 'unidades_horarios',
        titulo: 'Atendimento em Carmo do Rio Claro',
        pergunta: 'O doutor atende em Carmo do Rio Claro?',
        resposta:
          'Sim, em Carmo do Rio Claro o atendimento ocorre no consultório principal às segundas e quartas-feiras.',
        fonte: 'Conversas reais da Fabiana no WhatsApp',
        status: 'aprovada',
        origem: 'ia',
      },
      {
        categoria: 'suplementos',
        titulo: 'Indicações de Suplementos e Manipulados',
        pergunta: 'O Dr. Caio passa manipulados ou suplementos?',
        resposta:
          'A prescrição de suplementos e manipulados é individualizada na consulta, avaliando exames laboratoriais e objetivos do paciente. Nenhuma prescrição é feita pelo WhatsApp.',
        fonte: 'Diretriz clínica do Dr. Caio Candido',
        status: 'aprovada',
        origem: 'humano',
      },
      {
        categoria: 'orientacoes',
        titulo: 'Preparo para Exame de Bioimpedância',
        pergunta: 'Como devo me preparar para a bioimpedância?',
        resposta:
          'Jejum de alimentos e água de pelo menos 2 a 3 horas antes, não praticar atividade física intensa no dia, evitar bebidas alcoólicas nas 24h anteriores e urinar antes do teste.',
        fonte: 'Orientações operacionais da recepção / Fabiana',
        status: 'aprovada',
        origem: 'ia',
      },
      {
        categoria: 'protocolos',
        titulo: 'Política de Retornos da Consulta',
        pergunta: 'Qual o prazo para o retorno da consulta?',
        resposta:
          'O retorno deve ser agendado em até 30 a 45 dias após a consulta inicial, garantindo o acompanhamento da adesão ao plano nutricional.',
        fonte: 'Regra da clínica definida pelo Dr. Caio',
        status: 'proposta',
        origem: 'ia',
      },
      {
        categoria: 'precos',
        titulo: 'Formas de Pagamento Aceitas',
        pergunta: 'Quais são as formas de pagamento aceitas?',
        resposta:
          'Aceitamos Pix, transferência bancária e cartão de crédito/débito. O pagamento pode ser feito no dia do atendimento ou com link prévio enviado pela Fabiana.',
        fonte: 'Rotinas financeiras da recepção',
        status: 'proposta',
        origem: 'ia',
      },
    ]

    for (var a = 0; a < accounts.length; a++) {
      var accId = accounts[a].id
      var owner = accounts[a].getString('owner_id')
      for (var s = 0; s < seedCards.length; s++) {
        var card = seedCards[s]
        var exists = false
        try {
          var found = app.findRecordsByFilter(
            'knowledge_base',
            'account_id = {:aid} && titulo = {:titulo}',
            '-created',
            1,
            0,
            { aid: accId, titulo: card.titulo },
          )
          if (found && found.length > 0) exists = true
        } catch (_) {}

        if (!exists) {
          var rec = new Record(kbCollection)
          rec.set('account_id', accId)
          rec.set('categoria', card.categoria)
          rec.set('titulo', card.titulo)
          rec.set('pergunta', card.pergunta)
          rec.set('resposta', card.resposta)
          rec.set('fonte', card.fonte)
          rec.set('status', card.status)
          rec.set('origem', card.origem)
          if (card.status === 'aprovada') {
            if (owner) rec.set('approved_by', owner)
            rec.set('approved_at', new Date().toISOString())
          }
          app.save(rec)
        }
      }
    }
  },
  (app) => {
    try {
      var col = app.findCollectionByNameOrId('knowledge_base')
      app.delete(col)
    } catch (_) {}
  },
)
