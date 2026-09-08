migrate(
  (app) => {
    // 1. Adicionar campo 'archived' (bool) em crm_contacts para suportar arquivamento/desarquivamento em lote
    var crmCol = app.findCollectionByNameOrId('crm_contacts')
    if (!crmCol.fields.getByName('archived')) {
      crmCol.fields.add(
        new BoolField({
          name: 'archived',
          required: false,
        }),
      )
      app.save(crmCol)
    }

    // 2. Garantir que todas as coleções sensíveis tenham RLS estrito
    // NUNCA list ou view públicos ("" ou null para superusers apenas).
    // Devem permitir acesso exclusivamente a usuários autenticados da conta correspondente.
    var accountRestrictedCollections = [
      'crm_contacts',
      'whatsapp_messages',
      'conversations',
      'tasks',
      'follow_up_rules',
      'care_followup_rules',
      'message_templates',
      'care_alerts',
      'care_alert_settings',
      'care_silence_periods',
      'care_followup_thresholds',
      'categories',
      'crm_stages',
      'crm_companies',
    ]

    var standardRule =
      "@request.auth.id != '' && account_id.account_members_via_account_id.user_id ?= @request.auth.id"

    for (var i = 0; i < accountRestrictedCollections.length; i++) {
      var colName = accountRestrictedCollections[i]
      try {
        var col = app.findCollectionByNameOrId(colName)
        col.listRule = standardRule
        col.viewRule = standardRule
        col.createRule = standardRule
        col.updateRule = standardRule
        col.deleteRule = standardRule
        app.save(col)
      } catch (_) {
        // Coleção pode não existir com esse nome (ex: follow_up_rules vs care_followup_rules)
      }
    }

    // 3. Regra de whatsapp_instances: manter estrita para membros da conta, sem tocar na instância ativa
    try {
      var wiCol = app.findCollectionByNameOrId('whatsapp_instances')
      wiCol.listRule = standardRule
      wiCol.viewRule = standardRule
      wiCol.createRule = standardRule
      wiCol.updateRule = standardRule
      wiCol.deleteRule = standardRule
      app.save(wiCol)
    } catch (_) {}

    // 4. Regra de users: apenas o próprio usuário autenticado
    try {
      var usersCol = app.findCollectionByNameOrId('_pb_users_auth_')
      usersCol.listRule = 'id = @request.auth.id'
      usersCol.viewRule = 'id = @request.auth.id'
      usersCol.createRule = ''
      usersCol.updateRule = 'id = @request.auth.id'
      usersCol.deleteRule = 'id = @request.auth.id'
      app.save(usersCol)
    } catch (_) {}
  },
  (app) => {
    try {
      var crmCol = app.findCollectionByNameOrId('crm_contacts')
      if (crmCol.fields.getByName('archived')) {
        crmCol.fields.removeByName('archived')
        app.save(crmCol)
      }
    } catch (_) {}
  },
)
