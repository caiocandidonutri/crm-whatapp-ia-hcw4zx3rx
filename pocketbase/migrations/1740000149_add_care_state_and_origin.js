migrate(
  (app) => {
    // 1. Atualizar tasks collection para aceitar status "resolvida_auto"
    const tasksCol = app.findCollectionByNameOrId('tasks')
    const statusField = tasksCol.fields.getByName('status')
    if (statusField) {
      statusField.values = [
        'pendente',
        'em_andamento',
        'concluida',
        'cancelada',
        'arquivada_baseline',
        'resolvida_auto',
      ]
      app.save(tasksCol)
    }

    // 2. Adicionar campo origin em whatsapp_messages
    const msgCol = app.findCollectionByNameOrId('whatsapp_messages')
    if (!msgCol.fields.getByName('origin')) {
      msgCol.fields.add(
        new SelectField({
          name: 'origin',
          values: ['humano_celular', 'humano_crm', 'ia', 'automacao', 'desconhecido'],
          maxSelect: 1,
          required: false,
        }),
      )
      app.save(msgCol)
    }

    // 3. Adicionar campos de care_state em crm_contacts
    const contactsCol = app.findCollectionByNameOrId('crm_contacts')
    let contactsModified = false
    if (!contactsCol.fields.getByName('care_state')) {
      contactsCol.fields.add(
        new TextField({
          name: 'care_state',
          required: false,
        }),
      )
      contactsModified = true
    }
    if (!contactsCol.fields.getByName('care_state_reason')) {
      contactsCol.fields.add(
        new TextField({
          name: 'care_state_reason',
          required: false,
        }),
      )
      contactsModified = true
    }
    if (!contactsCol.fields.getByName('last_human_contact_at')) {
      contactsCol.fields.add(
        new DateField({
          name: 'last_human_contact_at',
          required: false,
        }),
      )
      contactsModified = true
    }
    if (!contactsCol.fields.getByName('last_reconciled_at')) {
      contactsCol.fields.add(
        new DateField({
          name: 'last_reconciled_at',
          required: false,
        }),
      )
      contactsModified = true
    }
    if (!contactsCol.fields.getByName('alert_active')) {
      contactsCol.fields.add(
        new BoolField({
          name: 'alert_active',
          required: false,
        }),
      )
      contactsModified = true
    }
    if (contactsModified) {
      app.save(contactsCol)
    }

    // 4. Adicionar authorized_senders e alert_drift_fixes em care_alert_settings
    const settingsCol = app.findCollectionByNameOrId('care_alert_settings')
    let settingsModified = false
    if (!settingsCol.fields.getByName('authorized_senders')) {
      settingsCol.fields.add(
        new TextField({
          name: 'authorized_senders',
          required: false,
        }),
      )
      settingsModified = true
    }
    if (!settingsCol.fields.getByName('alert_drift_fixes')) {
      settingsCol.fields.add(
        new NumberField({
          name: 'alert_drift_fixes',
          required: false,
        }),
      )
      settingsModified = true
    }
    if (settingsModified) {
      app.save(settingsCol)
    }

    // 5. Preenchimento retroativo em whatsapp_messages:
    // "ia" se tem assinatura/marca de IA (pending_ai_response=true ou [IA] ou Assistente), senão "desconhecido"
    // SEM reclassificação heurística retroativa
    app
      .db()
      .newQuery(`
    UPDATE whatsapp_messages
    SET origin = CASE
      WHEN origin IS NOT NULL AND origin != '' THEN origin
      WHEN push_name LIKE '%Assistente%' OR push_name LIKE '%IA%' OR content LIKE '%[IA]%' OR pending_ai_response = 1 THEN 'ia'
      ELSE 'desconhecido'
    END
    WHERE origin IS NULL OR origin = ''
  `)
      .execute()
  },
  (app) => {
    // Down
  },
)
