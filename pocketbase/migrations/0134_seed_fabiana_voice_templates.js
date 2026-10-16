migrate(
  (app) => {
    // Busca todas as contas existentes
    var accounts = []
    try {
      accounts = app.findRecordsByFilter('accounts', 'id != ""', 'created', 500, 0)
    } catch (_) {}

    var templatesCol = app.findCollectionByNameOrId('message_templates')

    // Modelos com a voz real da Fabiana (LGPD compliant, baseados nas mensagens reais dela)
    var seedTemplates = [
      {
        name: 'Follow-up Voz da Fabiana',
        trigger_type: 'pos_consulta',
        content:
          'Passando para saber como você está e como tem se sentido 😊💚 Esperamos que esteja tudo bem por aí! Qualquer coisa, pode me chamar.',
        is_fabiana_voice: true,
      },
      {
        name: 'Despedida · Fica com Deus',
        trigger_type: 'pos_consulta',
        content: 'Qualquer dúvida estamos à disposição! Fica com Deus 🙏',
        is_fabiana_voice: true,
      },
      {
        name: 'Despedida · Excelente dia',
        trigger_type: 'primeiro_contato',
        content: 'Fico aqui à sua disposição. Tenha um excelente dia! 😊',
        is_fabiana_voice: true,
      },
    ]

    for (var a = 0; a < accounts.length; a++) {
      var accountId = accounts[a].id
      var ownerId = accounts[a].getString('owner_id')

      for (var s = 0; s < seedTemplates.length; s++) {
        var tpl = seedTemplates[s]
        // Idempotência: verifica se já existe template com mesmo nome ou conteúdo semelhante nesta conta
        var exists = false
        try {
          var found = app.findRecordsByFilter(
            'message_templates',
            'account_id = {:aid} && (name = {:name} || content ~ {:contentSnippet})',
            '-created',
            1,
            0,
            {
              aid: accountId,
              name: tpl.name,
              contentSnippet: tpl.content.substring(0, 20),
            },
          )
          if (found && found.length > 0) {
            exists = true
          }
        } catch (_) {}

        if (!exists) {
          var record = new Record(templatesCol)
          record.set('account_id', accountId)
          record.set('name', tpl.name)
          record.set('trigger_type', tpl.trigger_type)
          record.set('content', tpl.content)
          record.set('is_fabiana_voice', true)
          if (ownerId) {
            record.set('created_by', ownerId)
          }
          app.save(record)
        }
      }
    }
  },
  (app) => {
    // Reversão limpa
    try {
      var toDelete = app.findRecordsByFilter(
        'message_templates',
        'name = "Follow-up Voz da Fabiana" || name = "Despedida · Fica com Deus" || name = "Despedida · Excelente dia"',
        '-created',
        100,
        0,
      )
      for (var i = 0; i < toDelete.length; i++) {
        app.delete(toDelete[i])
      }
    } catch (_) {}
  },
)
