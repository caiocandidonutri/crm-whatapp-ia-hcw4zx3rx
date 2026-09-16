migrate(
  (app) => {
    var accountsId = app.findCollectionByNameOrId('accounts').id
    var contactsId = app.findCollectionByNameOrId('crm_contacts').id
    var appointmentsId = app.findCollectionByNameOrId('appointments').id

    // 1. Coleção quick_replies
    var quickRepliesCol = new Collection({
      name: 'quick_replies',
      type: 'base',
      listRule:
        "@request.auth.id != '' && account_id.account_members_via_account_id.user_id ?= @request.auth.id",
      viewRule:
        "@request.auth.id != '' && account_id.account_members_via_account_id.user_id ?= @request.auth.id",
      createRule:
        "@request.auth.id != '' && account_id.account_members_via_account_id.user_id ?= @request.auth.id",
      updateRule:
        "@request.auth.id != '' && account_id.account_members_via_account_id.user_id ?= @request.auth.id",
      deleteRule:
        "@request.auth.id != '' && account_id.account_members_via_account_id.user_id ?= @request.auth.id",
      fields: [
        {
          name: 'account_id',
          type: 'relation',
          required: true,
          collectionId: accountsId,
          maxSelect: 1,
        },
        { name: 'title', type: 'text', required: true, max: 200 },
        { name: 'shortcut', type: 'text', required: false, max: 50 },
        { name: 'body', type: 'text', required: true, max: 3000 },
        { name: 'category', type: 'text', required: false, max: 100 },
        { name: 'sort_order', type: 'number', required: false },
        { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
      ],
      indexes: [
        'CREATE INDEX idx_quick_replies_account ON quick_replies (account_id)',
        'CREATE INDEX idx_quick_replies_category ON quick_replies (category)',
      ],
    })
    app.save(quickRepliesCol)

    // 2. Coleção business_hours
    var businessHoursCol = new Collection({
      name: 'business_hours',
      type: 'base',
      listRule:
        "@request.auth.id != '' && account_id.account_members_via_account_id.user_id ?= @request.auth.id",
      viewRule:
        "@request.auth.id != '' && account_id.account_members_via_account_id.user_id ?= @request.auth.id",
      createRule:
        "@request.auth.id != '' && account_id.account_members_via_account_id.user_id ?= @request.auth.id",
      updateRule:
        "@request.auth.id != '' && account_id.account_members_via_account_id.user_id ?= @request.auth.id",
      deleteRule:
        "@request.auth.id != '' && account_id.account_members_via_account_id.user_id ?= @request.auth.id",
      fields: [
        {
          name: 'account_id',
          type: 'relation',
          required: true,
          collectionId: accountsId,
          maxSelect: 1,
        },
        { name: 'dia_semana', type: 'number', required: true, min: 0, max: 6 },
        { name: 'ativo', type: 'bool', required: false },
        { name: 'abre', type: 'text', required: true, max: 10 },
        { name: 'fecha', type: 'text', required: true, max: 10 },
        { name: 'unidade', type: 'text', required: false, max: 100 },
        { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
      ],
      indexes: [
        'CREATE INDEX idx_business_hours_account ON business_hours (account_id)',
        'CREATE INDEX idx_business_hours_dia ON business_hours (dia_semana)',
      ],
    })
    app.save(businessHoursCol)

    // 3. Coleção waitlist
    var waitlistCol = new Collection({
      name: 'waitlist',
      type: 'base',
      listRule:
        "@request.auth.id != '' && account_id.account_members_via_account_id.user_id ?= @request.auth.id",
      viewRule:
        "@request.auth.id != '' && account_id.account_members_via_account_id.user_id ?= @request.auth.id",
      createRule:
        "@request.auth.id != '' && account_id.account_members_via_account_id.user_id ?= @request.auth.id",
      updateRule:
        "@request.auth.id != '' && account_id.account_members_via_account_id.user_id ?= @request.auth.id",
      deleteRule:
        "@request.auth.id != '' && account_id.account_members_via_account_id.user_id ?= @request.auth.id",
      fields: [
        {
          name: 'account_id',
          type: 'relation',
          required: true,
          collectionId: accountsId,
          maxSelect: 1,
        },
        {
          name: 'contact_id',
          type: 'relation',
          required: false,
          collectionId: contactsId,
          maxSelect: 1,
        },
        { name: 'nome', type: 'text', required: true, max: 200 },
        { name: 'telefone', type: 'text', required: true, max: 50 },
        {
          name: 'tipo_desejado',
          type: 'select',
          required: true,
          values: ['Consulta', 'Retorno', 'Consultoria', 'Bioimpedância', 'Outro'],
          maxSelect: 1,
        },
        {
          name: 'cidade_preferida',
          type: 'select',
          required: false,
          values: ['Carmo do Rio Claro', 'Alfenas', 'Monte Belo', 'Online', 'Qualquer'],
          maxSelect: 1,
        },
        {
          name: 'periodo_preferido',
          type: 'select',
          required: false,
          values: ['manha', 'tarde', 'qualquer'],
          maxSelect: 1,
        },
        { name: 'observacao', type: 'text', required: false, max: 1000 },
        {
          name: 'status',
          type: 'select',
          required: true,
          values: ['aguardando', 'avisado', 'agendado', 'cancelado'],
          maxSelect: 1,
        },
        { name: 'avisado_em', type: 'date', required: false },
        { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
      ],
      indexes: [
        'CREATE INDEX idx_waitlist_account ON waitlist (account_id)',
        'CREATE INDEX idx_waitlist_status ON waitlist (status)',
        'CREATE INDEX idx_waitlist_created ON waitlist (created)',
      ],
    })
    app.save(waitlistCol)

    // 4. Coleção satisfaction_surveys
    var satisfactionSurveysCol = new Collection({
      name: 'satisfaction_surveys',
      type: 'base',
      listRule:
        "@request.auth.id != '' && account_id.account_members_via_account_id.user_id ?= @request.auth.id",
      viewRule:
        "@request.auth.id != '' && account_id.account_members_via_account_id.user_id ?= @request.auth.id",
      createRule:
        "@request.auth.id != '' && account_id.account_members_via_account_id.user_id ?= @request.auth.id",
      updateRule:
        "@request.auth.id != '' && account_id.account_members_via_account_id.user_id ?= @request.auth.id",
      deleteRule:
        "@request.auth.id != '' && account_id.account_members_via_account_id.user_id ?= @request.auth.id",
      fields: [
        {
          name: 'account_id',
          type: 'relation',
          required: true,
          collectionId: accountsId,
          maxSelect: 1,
        },
        {
          name: 'contact_id',
          type: 'relation',
          required: false,
          collectionId: contactsId,
          maxSelect: 1,
        },
        {
          name: 'appointment_id',
          type: 'relation',
          required: false,
          collectionId: appointmentsId,
          maxSelect: 1,
        },
        { name: 'score', type: 'number', required: false, min: 0, max: 10 },
        { name: 'feedback', type: 'text', required: false, max: 2000 },
        { name: 'recebida_em', type: 'date', required: false },
        { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
      ],
      indexes: [
        'CREATE INDEX idx_surveys_account ON satisfaction_surveys (account_id)',
        'CREATE INDEX idx_surveys_appointment ON satisfaction_surveys (appointment_id)',
        'CREATE INDEX idx_surveys_contact ON satisfaction_surveys (contact_id)',
      ],
    })
    app.save(satisfactionSurveysCol)

    // 5. Adicionar campos às coleções existentes
    // care_alert_settings:
    // - after_hours_enabled (bool)
    // - survey_enabled (bool)
    // - survey_q1 (text)
    // - survey_q2 (text)
    var careSettingsCol = app.findCollectionByNameOrId('care_alert_settings')
    if (!careSettingsCol.fields.getByName('after_hours_enabled')) {
      careSettingsCol.fields.add(new BoolField({ name: 'after_hours_enabled' }))
    }
    if (!careSettingsCol.fields.getByName('survey_enabled')) {
      careSettingsCol.fields.add(new BoolField({ name: 'survey_enabled' }))
    }
    if (!careSettingsCol.fields.getByName('survey_q1')) {
      careSettingsCol.fields.add(new TextField({ name: 'survey_q1', max: 500 }))
    }
    if (!careSettingsCol.fields.getByName('survey_q2')) {
      careSettingsCol.fields.add(new TextField({ name: 'survey_q2', max: 500 }))
    }
    app.save(careSettingsCol)

    // conversations:
    // - last_after_hours_sent_at (date)
    // - awaiting_contact_reason (bool)
    // - awaiting_survey_response (bool)
    var convCol = app.findCollectionByNameOrId('conversations')
    if (!convCol.fields.getByName('last_after_hours_sent_at')) {
      convCol.fields.add(new DateField({ name: 'last_after_hours_sent_at' }))
    }
    if (!convCol.fields.getByName('awaiting_contact_reason')) {
      convCol.fields.add(new BoolField({ name: 'awaiting_contact_reason' }))
    }
    if (!convCol.fields.getByName('awaiting_survey_response')) {
      convCol.fields.add(new BoolField({ name: 'awaiting_survey_response' }))
    }
    app.save(convCol)

    // crm_contacts:
    // - contact_reason (text)
    // - contact_reason_category (text)
    var crmCol = app.findCollectionByNameOrId('crm_contacts')
    if (!crmCol.fields.getByName('contact_reason')) {
      crmCol.fields.add(new TextField({ name: 'contact_reason', max: 500 }))
    }
    if (!crmCol.fields.getByName('contact_reason_category')) {
      crmCol.fields.add(new TextField({ name: 'contact_reason_category', max: 50 }))
    }
    app.save(crmCol)

    // appointments:
    // - survey_sent (bool)
    // - survey_sent_at (date)
    var appCol = app.findCollectionByNameOrId('appointments')
    if (!appCol.fields.getByName('survey_sent')) {
      appCol.fields.add(new BoolField({ name: 'survey_sent' }))
    }
    if (!appCol.fields.getByName('survey_sent_at')) {
      appCol.fields.add(new DateField({ name: 'survey_sent_at' }))
    }
    app.save(appCol)
  },
  (app) => {
    try {
      app.delete(app.findCollectionByNameOrId('satisfaction_surveys'))
    } catch (_) {}
    try {
      app.delete(app.findCollectionByNameOrId('waitlist'))
    } catch (_) {}
    try {
      app.delete(app.findCollectionByNameOrId('business_hours'))
    } catch (_) {}
    try {
      app.delete(app.findCollectionByNameOrId('quick_replies'))
    } catch (_) {}
  },
)
