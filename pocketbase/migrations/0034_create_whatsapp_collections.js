migrate(
  (app) => {
    const usersId = '_pb_users_auth_'
    const users = app.findCollectionByNameOrId(usersId)
    if (!users.fields.getByName('name')) {
      users.fields.add(new TextField({ name: 'name' }))
    }
    if (!users.fields.getByName('avatar')) {
      users.fields.add(new FileField({ name: 'avatar', maxSelect: 1 }))
    }
    app.save(users)

    app.save(
      new Collection({
        name: 'whatsapp_instances',
        type: 'base',
        listRule: "@request.auth.id != '' && user_id = @request.auth.id",
        viewRule: "@request.auth.id != '' && user_id = @request.auth.id",
        createRule: "@request.auth.id != '' && user_id = @request.auth.id",
        updateRule: "@request.auth.id != '' && user_id = @request.auth.id",
        deleteRule: "@request.auth.id != '' && user_id = @request.auth.id",
        fields: [
          {
            name: 'user_id',
            type: 'relation',
            required: true,
            collectionId: usersId,
            maxSelect: 1,
          },
          { name: 'instance_name', type: 'text', required: true },
          { name: 'instance_id', type: 'text' },
          { name: 'instance_hash', type: 'text' },
          {
            name: 'status',
            type: 'select',
            values: ['creating', 'qrcode', 'connected', 'disconnected'],
            maxSelect: 1,
          },
          { name: 'phone_number', type: 'text' },
          { name: 'needs_initial_sync', type: 'bool' },
          { name: 'needs_resync', type: 'bool' },
          { name: 'auth_failure_count', type: 'number' },
          { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
          { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
          { name: 'is_importing_history', type: 'bool' },
          { name: 'import_messages_count', type: 'number' },
          { name: 'import_started_at', type: 'date' },
          { name: 'import_finished_at', type: 'date' },
          { name: 'sync_period_days', type: 'number' },
          { name: 'qrcode_base64', type: 'text' },
        ],
        indexes: [
          'CREATE UNIQUE INDEX idx_instance_name_user ON whatsapp_instances (user_id, instance_name)',
        ],
      }),
    )

    app.save(
      new Collection({
        name: 'conversations',
        type: 'base',
        listRule: "@request.auth.id != '' && user_id = @request.auth.id",
        viewRule: "@request.auth.id != '' && user_id = @request.auth.id",
        createRule: "@request.auth.id != '' && user_id = @request.auth.id",
        updateRule: "@request.auth.id != '' && user_id = @request.auth.id",
        deleteRule: "@request.auth.id != '' && user_id = @request.auth.id",
        fields: [
          {
            name: 'user_id',
            type: 'relation',
            required: true,
            collectionId: usersId,
            maxSelect: 1,
          },
          { name: 'instance_name', type: 'text', required: true },
          { name: 'remote_jid', type: 'text', required: true },
          { name: 'contact_name', type: 'text' },
          { name: 'contact_phone', type: 'text' },
          { name: 'is_group', type: 'bool' },
          { name: 'type', type: 'select', values: ['individual', 'group'], maxSelect: 1 },
          { name: 'avatar', type: 'file', maxSelect: 1 },
          { name: 'avatar_url', type: 'text' },
          { name: 'last_message', type: 'text' },
          { name: 'unread_count', type: 'number' },
          { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
          { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
          { name: 'picture_fetched_at', type: 'date' },
          { name: 'group_size', type: 'number' },
          { name: 'enrich_debug', type: 'text' },
          { name: 'history_synced_at', type: 'date' },
          { name: 'history_oldest_timestamp', type: 'number' },
          { name: 'last_message_timestamp', type: 'number' },
          { name: 'archived', type: 'bool' },
        ],
      }),
    )

    app.save(
      new Collection({
        name: 'whatsapp_messages',
        type: 'base',
        listRule: "@request.auth.id != '' && user_id = @request.auth.id",
        viewRule: "@request.auth.id != '' && user_id = @request.auth.id",
        createRule: "@request.auth.id != '' && user_id = @request.auth.id",
        updateRule: "@request.auth.id != '' && user_id = @request.auth.id",
        deleteRule: "@request.auth.id != '' && user_id = @request.auth.id",
        fields: [
          {
            name: 'user_id',
            type: 'relation',
            required: true,
            collectionId: usersId,
            maxSelect: 1,
          },
          { name: 'instance_name', type: 'text', required: true },
          { name: 'remote_jid', type: 'text', required: true },
          { name: 'from_me', type: 'bool' },
          { name: 'message_id', type: 'text' },
          { name: 'push_name', type: 'text' },
          { name: 'content', type: 'text' },
          { name: 'message_type', type: 'text' },
          { name: 'media_file', type: 'file', maxSelect: 1 },
          { name: 'status', type: 'text' },
          { name: 'timestamp', type: 'number' },
          { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
          { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
          { name: 'participant_jid', type: 'text' },
          { name: 'participant_pushname', type: 'text' },
          { name: 'media_url', type: 'text' },
          { name: 'media_mimetype', type: 'text' },
          { name: 'media_filename', type: 'text' },
          { name: 'reactions', type: 'json' },
          { name: 'link_url', type: 'text' },
          { name: 'link_title', type: 'text' },
          { name: 'link_description', type: 'text' },
          { name: 'link_thumbnail_b64', type: 'text' },
        ],
      }),
    )

    app.save(
      new Collection({
        name: 'mark_read_queue',
        type: 'base',
        listRule: "@request.auth.id != '' && user_id = @request.auth.id",
        viewRule: "@request.auth.id != '' && user_id = @request.auth.id",
        createRule: "@request.auth.id != ''",
        updateRule: null,
        deleteRule: null,
        fields: [
          {
            name: 'user_id',
            type: 'relation',
            required: true,
            collectionId: usersId,
            maxSelect: 1,
          },
          { name: 'instance_name', type: 'text', required: true },
          { name: 'remote_jid', type: 'text', required: true },
          { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
          { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
          { name: 'message_ids', type: 'text', required: true },
        ],
      }),
    )
  },
  (app) => {
    app.delete(app.findCollectionByNameOrId('mark_read_queue'))
    app.delete(app.findCollectionByNameOrId('whatsapp_messages'))
    app.delete(app.findCollectionByNameOrId('conversations'))
    app.delete(app.findCollectionByNameOrId('whatsapp_instances'))
  },
)
