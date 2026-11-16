// Idempotente: adiciona o valor 'paciente' ao select origin de whatsapp_messages.
// Novas mensagens recebidas de pacientes (from_me=false) passam a gravar
// origin='paciente' no webhook (antes gravavam 'desconhecido'). Nada é apagado
// e nenhum registro antigo é reclassificado.
migrate(
  (app) => {
    const col = app.findCollectionByNameOrId('whatsapp_messages')
    const originField = col.fields.getByName('origin')
    const values = originField.values || []
    if (values.indexOf('paciente') === -1) {
      originField.values = values.concat(['paciente'])
      app.save(col)
      console.log('migration 1740000207: valor paciente adicionado ao select origin')
    } else {
      console.log('migration 1740000207: valor paciente já presente — no-op')
    }
  },
  (app) => {
    // down: mantém o valor (soft-only); nada a fazer.
  },
)
