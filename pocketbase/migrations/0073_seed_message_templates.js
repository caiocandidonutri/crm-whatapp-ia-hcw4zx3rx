migrate(
  (app) => {
    var accounts = []
    try {
      accounts = app.findRecordsByFilter('accounts', 'id != ""', 'created', 500, 0)
    } catch (_) {}

    var defaults = [
      {
        name: 'Boas-vindas',
        trigger_type: 'primeiro_contato',
        content:
          'Olá, {nome}! Aqui é do consultório do Dr. Caio Cândido. Viemos te dar as boas-vindas e entender como podemos ajudar na sua saúde. 😊',
      },
      {
        name: 'Reengajamento',
        trigger_type: 'reengajamento',
        content:
          'Oi, {nome}! Faz um tempinho que não falamos. Como você está se sentindo? Passou por aqui alguma dúvida sobre sua alimentação ou consulta? Estamos à disposição! 💙',
      },
      {
        name: 'Pós-consulta',
        trigger_type: 'pos_consulta',
        content:
          'Olá, {nome}! Passando aqui para saber como você está depois da sua consulta com o Dr. Caio, que foi em {data} às {horario}. Qualquer dúvida sobre as orientações, é só chamar! 🌱',
      },
    ]

    var col = app.findCollectionByNameOrId('message_templates')

    for (var a = 0; a < accounts.length; a++) {
      var accountId = accounts[a].id
      var ownerId = accounts[a].getString('owner_id')
      for (var d = 0; d < defaults.length; d++) {
        try {
          app.findFirstRecordByFilter(
            'message_templates',
            'account_id = {:aid} && trigger_type = {:tt}',
            { aid: accountId, tt: defaults[d].trigger_type },
          )
        } catch (_) {
          var record = new Record(col)
          record.set('account_id', accountId)
          record.set('name', defaults[d].name)
          record.set('trigger_type', defaults[d].trigger_type)
          record.set('content', defaults[d].content)
          if (ownerId) record.set('created_by', ownerId)
          app.save(record)
        }
      }
    }
  },
  (app) => {},
)
