migrate(
  (app) => {
    // 3) Fila de envio com retry persistente:
    // Cria a coleção `whatsapp_send_queue` para persistir mensagens pendentes/com falha,
    // gerenciando tentativas com backoff exponencial e idempotência via `message_id` / `client_msg_id`.
    try {
      app.findCollectionByNameOrId('whatsapp_send_queue')
      console.log('[0141] Coleção whatsapp_send_queue já existe.')
      return
    } catch (_) {}

    const accountsCol = app.findCollectionByNameOrId('accounts')
    const instancesCol = app.findCollectionByNameOrId('whatsapp_instances')

    const queueCol = new Collection({
      name: 'whatsapp_send_queue',
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
          cascadeDelete: false,
          maxSelect: 1,
        },
        {
          name: 'instance_id',
          type: 'relation',
          collectionId: instancesCol.id,
          cascadeDelete: false,
          maxSelect: 1,
        },
        { name: 'instance_name', type: 'text', required: true },
        { name: 'remote_jid', type: 'text', required: true },
        { name: 'content', type: 'text' },
        { name: 'message_type', type: 'text' },
        { name: 'message_id', type: 'text' },
        {
          name: 'status',
          type: 'select',
          values: ['pending', 'processing', 'sent', 'failed', 'cancelled'],
          maxSelect: 1,
        },
        { name: 'retry_count', type: 'number' },
        { name: 'max_retries', type: 'number' },
        { name: 'next_retry_at', type: 'date' },
        { name: 'last_error', type: 'text' },
        { name: 'sent_at', type: 'date' },
        { name: 'payload', type: 'json' },
        { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
      ],
      indexes: [
        'CREATE INDEX idx_queue_status_retry ON whatsapp_send_queue (status, next_retry_at)',
        'CREATE INDEX idx_queue_message_id ON whatsapp_send_queue (message_id)',
        'CREATE INDEX idx_queue_account ON whatsapp_send_queue (account_id)',
      ],
    })

    app.save(queueCol)
    console.log('[0141] Coleção whatsapp_send_queue criada com sucesso.')
  },
  (app) => {
    try {
      const col = app.findCollectionByNameOrId('whatsapp_send_queue')
      app.delete(col)
    } catch (_) {}
  },
)
