migrate(
  (app) => {
    // 1. Adicionar campo last_ai_reclassified_at em crm_contacts para controlar o cooldown de 6h
    const contactCol = app.findCollectionByNameOrId('crm_contacts')
    if (!contactCol.fields.getByName('last_ai_reclassified_at')) {
      contactCol.fields.add(
        new DateField({
          name: 'last_ai_reclassified_at',
          required: false,
        }),
      )
      app.save(contactCol)
    }

    // 2. Criar coleção app_daily_usage para controlar tetos diários configuráveis (transcrições e análises IA)
    let usageCol = null
    try {
      usageCol = app.findCollectionByNameOrId('app_daily_usage')
    } catch (_) {}

    if (!usageCol) {
      const usersCol = app.findCollectionByNameOrId('_pb_users_auth_')
      const accCol = app.findCollectionByNameOrId('accounts')
      usageCol = new Collection({
        name: 'app_daily_usage',
        type: 'base',
        listRule: "@request.auth.id != ''",
        viewRule: "@request.auth.id != ''",
        createRule: "@request.auth.id != ''",
        updateRule: "@request.auth.id != ''",
        deleteRule: null,
        fields: [
          { name: 'day_key', type: 'text', required: true }, // 'YYYY-MM-DD' em São Paulo
          {
            name: 'account_id',
            type: 'relation',
            collectionId: accCol.id,
            maxSelect: 1,
            required: false,
          },
          { name: 'transcriptions_count', type: 'number', required: false },
          { name: 'transcriptions_limit', type: 'number', required: false }, // default 150
          { name: 'ai_analyses_count', type: 'number', required: false },
          { name: 'ai_analyses_limit', type: 'number', required: false }, // default 200
          { name: 'transcriptions_paused', type: 'bool', required: false },
          { name: 'ai_analyses_paused', type: 'bool', required: false },
          { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
          { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
        ],
        indexes: [
          'CREATE UNIQUE INDEX idx_daily_usage_day_acc ON app_daily_usage (day_key, account_id)',
        ],
      })
      app.save(usageCol)
    }

    // 3. Limpeza retroativa de áudios que NÃO devem ser transcritos:
    // A) Contatos com stage = 'cliente' (fechados): áudios de cliente nunca mudam conduta no pipeline de leads.
    // B) Conversas arquivadas (conversations.archived = true).
    // C) Mensagens de conversas sem movimentação há mais de 7 dias (baseado em timestamp / created < 7 dias atrás)
    //    OU mensagens com timestamp mais antigo que 7 dias atrás.
    // Marcaremos transcription = 'SKIP_NO_TRANSCRIBE' para que a fila nunca processe.
    const nowSec = Math.floor(Date.now() / 1000)
    const sevenDaysSec = 7 * 86400
    const cutoffTs = nowSec - sevenDaysSec
    const cutoffDate = new Date(Date.now() - sevenDaysSec * 1000).toISOString().replace('T', ' ')

    // 3.1 Áudios de contatos com stage='cliente'
    try {
      app
        .db()
        .newQuery(`
          UPDATE whatsapp_messages
          SET transcription = 'SKIP_NO_TRANSCRIBE'
          WHERE (transcription IS NULL OR transcription = '')
            AND (message_type = 'audioMessage' OR message_type = 'audio' OR message_type = 'ptt' OR media_file LIKE '%.ogg' OR media_filename LIKE '%.ogg')
            AND remote_jid IN (
              SELECT jid FROM crm_contacts WHERE stage = 'cliente' AND jid IS NOT NULL AND jid != ''
            )
        `)
        .execute()
    } catch (e1) {
      console.log('[0087_cleanup] Erro ao marcar áudios de clientes:', e1)
    }

    // 3.2 Áudios de conversas arquivadas
    try {
      app
        .db()
        .newQuery(`
          UPDATE whatsapp_messages
          SET transcription = 'SKIP_NO_TRANSCRIBE'
          WHERE (transcription IS NULL OR transcription = '')
            AND (message_type = 'audioMessage' OR message_type = 'audio' OR message_type = 'ptt' OR media_file LIKE '%.ogg' OR media_filename LIKE '%.ogg')
            AND remote_jid IN (
              SELECT remote_jid FROM conversations WHERE archived = 1 AND remote_jid IS NOT NULL AND remote_jid != ''
            )
        `)
        .execute()
    } catch (e2) {
      console.log('[0087_cleanup] Erro ao marcar áudios de conversas arquivadas:', e2)
    }

    // 3.3 Áudios sem movimentação há mais de 7 dias ou com timestamp < cutoffTs
    try {
      app
        .db()
        .newQuery(`
          UPDATE whatsapp_messages
          SET transcription = 'SKIP_NO_TRANSCRIBE'
          WHERE (transcription IS NULL OR transcription = '')
            AND (message_type = 'audioMessage' OR message_type = 'audio' OR message_type = 'ptt' OR media_file LIKE '%.ogg' OR media_filename LIKE '%.ogg')
            AND (
              (timestamp > 0 AND timestamp < {:cutoffTs})
              OR (timestamp <= 0 AND created < {:cutoffDate})
              OR remote_jid IN (
                SELECT remote_jid FROM conversations
                WHERE (last_message_timestamp > 0 AND last_message_timestamp < {:cutoffTs})
                   OR (last_message_timestamp <= 0 AND updated < {:cutoffDate})
              )
            )
        `)
        .bind({ cutoffTs: cutoffTs, cutoffDate: cutoffDate })
        .execute()
    } catch (e3) {
      console.log('[0087_cleanup] Erro ao marcar áudios antigos > 7 dias:', e3)
    }
  },
  (app) => {
    try {
      const contactCol = app.findCollectionByNameOrId('crm_contacts')
      if (contactCol.fields.getByName('last_ai_reclassified_at')) {
        contactCol.fields.removeByName('last_ai_reclassified_at')
        app.save(contactCol)
      }
    } catch (_) {}

    try {
      const usageCol = app.findCollectionByNameOrId('app_daily_usage')
      if (usageCol) {
        app.delete(usageCol)
      }
    } catch (_) {}
  },
)
