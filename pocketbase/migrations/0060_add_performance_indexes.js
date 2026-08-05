migrate(
  (app) => {
    const convCol = app.findCollectionByNameOrId('conversations')
    convCol.addIndex(
      'idx_conv_account_instance_archived',
      false,
      'account_id, instance_name, archived',
      '',
    )
    convCol.addIndex('idx_conv_user_instance', false, 'user_id, instance_name', '')
    convCol.addIndex('idx_conv_last_msg_ts', false, 'last_message_timestamp', '')
    convCol.addIndex('idx_conv_updated', false, 'updated', '')
    app.save(convCol)

    const msgCol = app.findCollectionByNameOrId('whatsapp_messages')
    msgCol.addIndex(
      'idx_msg_account_instance_jid',
      false,
      'account_id, instance_name, remote_jid',
      '',
    )
    msgCol.addIndex('idx_msg_user_instance_jid', false, 'user_id, instance_name, remote_jid', '')
    msgCol.addIndex('idx_msg_timestamp', false, 'timestamp', '')
    msgCol.addIndex('idx_msg_created', false, 'created', '')
    app.save(msgCol)
  },
  (app) => {
    const convCol = app.findCollectionByNameOrId('conversations')
    convCol.removeIndex('idx_conv_account_instance_archived')
    convCol.removeIndex('idx_conv_user_instance')
    convCol.removeIndex('idx_conv_last_msg_ts')
    convCol.removeIndex('idx_conv_updated')
    app.save(convCol)

    const msgCol = app.findCollectionByNameOrId('whatsapp_messages')
    msgCol.removeIndex('idx_msg_account_instance_jid')
    msgCol.removeIndex('idx_msg_user_instance_jid')
    msgCol.removeIndex('idx_msg_timestamp')
    msgCol.removeIndex('idx_msg_created')
    app.save(msgCol)
  },
)
