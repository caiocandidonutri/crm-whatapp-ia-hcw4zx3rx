migrate(
  (app) => {
    // 1. Atualizar contatos da equipe (Dr. Caio e Fabiana) para is_patient = false e role = nao_paciente
    // Telefones da equipe: 553599288027, 553599716747, 553598643443
    const staffPhones = ['553599288027', '553599716747', '553598643443']
    for (let p = 0; p < staffPhones.length; p++) {
      const ph = staffPhones[p]
      try {
        app
          .db()
          .newQuery(
            "UPDATE crm_contacts SET is_patient = 0, role = 'nao_paciente' WHERE phone = {:ph} OR jid LIKE {:jid}",
          )
          .bind({ ph: ph, jid: '%' + ph + '%' })
          .execute()
      } catch (err) {
        console.log('[migration 0132] Erro ao atualizar telefone da equipe ' + ph + ': ' + err)
      }
    }

    // Também garantir para qualquer contato onde contact_name ou push_name contenha Dr. Caio Candido
    try {
      app
        .db()
        .newQuery(
          "UPDATE crm_contacts SET is_patient = 0, role = 'nao_paciente' WHERE (contact_name LIKE '%Caio Candido%' OR push_name LIKE '%Caio Candido%') AND is_patient = 1",
        )
        .execute()
    } catch (_) {}

    // 2. Campo team_numbers em care_alert_settings para configurar números da equipe
    const careSettingsCol = app.findCollectionByNameOrId('care_alert_settings')
    if (!careSettingsCol.fields.getByName('team_numbers')) {
      careSettingsCol.fields.add(
        new TextField({
          name: 'team_numbers',
          max: 1000,
        }),
      )
    }
    app.save(careSettingsCol)

    // Preencher padrão nos registros existentes de care_alert_settings
    try {
      const settings = app.findRecordsByFilter('care_alert_settings', '', '-created', 50, 0)
      for (let s = 0; s < settings.length; s++) {
        const st = settings[s]
        if (!st.getString('team_numbers')) {
          st.set('team_numbers', '553599288027, 553599716747, 553598643443')
          app.save(st)
        }
      }
    } catch (_) {}

    // 3. Campo is_fabiana_voice em message_templates (Modo Fabiana)
    const templatesCol = app.findCollectionByNameOrId('message_templates')
    if (!templatesCol.fields.getByName('is_fabiana_voice')) {
      templatesCol.fields.add(
        new BoolField({
          name: 'is_fabiana_voice',
        }),
      )
    }
    app.save(templatesCol)

    // 4. Coleção onboarding_progress para salvar o checklist da recepção por usuário
    let onboardingCol = null
    try {
      onboardingCol = app.findCollectionByNameOrId('onboarding_progress')
    } catch (_) {}

    if (!onboardingCol) {
      const usersCol = app.findCollectionByNameOrId('users')
      const accountsCol = app.findCollectionByNameOrId('accounts')
      const newCol = new Collection({
        name: 'onboarding_progress',
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
            collectionId: usersCol.id,
            maxSelect: 1,
          },
          {
            name: 'account_id',
            type: 'relation',
            required: false,
            collectionId: accountsCol.id,
            maxSelect: 1,
          },
          {
            name: 'completed_tasks',
            type: 'json',
            required: false,
          },
          {
            name: 'notes',
            type: 'text',
            required: false,
            max: 2000,
          },
          { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
          { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
        ],
        indexes: ['CREATE INDEX idx_onboarding_user ON onboarding_progress (user_id)'],
      })
      app.save(newCol)
    }
  },
  (app) => {
    try {
      app.delete(app.findCollectionByNameOrId('onboarding_progress'))
    } catch (_) {}
  },
)
