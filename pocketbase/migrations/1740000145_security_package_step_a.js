migrate(
  (app) => {
    // 1. Fechar cadastro público em `users`: createRule = null (superuser only)
    // Conforme auditado: novos usuários são convidados/criados via endpoints server-side
    // (/backend/v1/team/invite e /backend/v1/team/create-member) que usam $app (superuser),
    // preservando authRule e authWithPassword para login existente.
    try {
      const usersCol = app.findCollectionByNameOrId('users')
      usersCol.createRule = null
      app.save(usersCol)
      console.log('[1740000145] users.createRule fechado com sucesso (null).')
    } catch (err) {
      console.log('[1740000145] Erro ao atualizar users.createRule: ' + err)
    }

    // Regra padrão de escopo por conta multitenant
    const accountScopedRule =
      "@request.auth.id != '' && account_id.account_members_via_account_id.user_id ?= @request.auth.id"

    // 2. Collections de dados da clínica com regra frouxa (@request.auth.id != '')
    // que devem receber escopo por conta (account_id):
    // - knowledge_base (previamente @request.auth.id != "")
    // - payments (previamente @request.auth.id != "")
    // - whatsapp_send_queue (previamente @request.auth.id != "")
    // - appointments (dados de consultas e pacientes da clínica, previamente @request.auth.id != "")
    // - app_daily_usage (consumo de IA/transcrições por conta, previamente @request.auth.id != '')
    const collectionsToAccountScope = [
      'knowledge_base',
      'payments',
      'whatsapp_send_queue',
      'appointments',
      'app_daily_usage',
    ]

    for (const colName of collectionsToAccountScope) {
      try {
        const col = app.findCollectionByNameOrId(colName)
        col.listRule = accountScopedRule
        col.viewRule = accountScopedRule
        col.createRule = accountScopedRule
        col.updateRule = accountScopedRule
        if (colName !== 'app_daily_usage') {
          col.deleteRule = accountScopedRule
        }
        app.save(col)
        console.log('[1740000145] ' + colName + ' atualizado para regra de conta.')
      } catch (err) {
        console.log('[1740000145] Erro ao atualizar ' + colName + ': ' + err)
      }
    }

    // 3. Auditoria das demais collections solicitadas:
    // - conversations, whatsapp_messages, mark_read_queue, tasks, ai_agents, crm_companies:
    //   Já estavam com accountScopedRule desde a migração 0044. Mantidas e reforçadas.
    // - notifications: dados individuais do usuário, já usa regra por usuário (@request.auth.id != "" && user_id = @request.auth.id). Mantida por ser pessoal.
    // - onboarding_progress: progresso de onboarding por usuário (@request.auth.id != '' && user_id = @request.auth.id). Mantida por ser pessoal.
    // - sync_state: estado global de sincronização externa da clínica (sem account_id).
    //   Acesso de escrita fechado (superuser only) e leitura apenas para usuários autenticados da clínica.
    try {
      const syncCol = app.findCollectionByNameOrId('sync_state')
      syncCol.listRule = "@request.auth.id != ''"
      syncCol.viewRule = "@request.auth.id != ''"
      syncCol.createRule = null
      syncCol.updateRule = null
      syncCol.deleteRule = null
      app.save(syncCol)
      console.log('[1740000145] sync_state protegido para leitura auth e escrita superuser.')
    } catch (err) {
      console.log('[1740000145] Erro ao atualizar sync_state: ' + err)
    }
  },
  (app) => {
    try {
      const usersCol = app.findCollectionByNameOrId('users')
      usersCol.createRule = ''
      app.save(usersCol)
    } catch (_) {}

    const openAuthRule = '@request.auth.id != ""'
    const collectionsToRevert = [
      'knowledge_base',
      'payments',
      'whatsapp_send_queue',
      'appointments',
    ]

    for (const colName of collectionsToRevert) {
      try {
        const col = app.findCollectionByNameOrId(colName)
        col.listRule = openAuthRule
        col.viewRule = openAuthRule
        col.createRule = openAuthRule
        col.updateRule = openAuthRule
        col.deleteRule = openAuthRule
        app.save(col)
      } catch (_) {}
    }

    try {
      const usageCol = app.findCollectionByNameOrId('app_daily_usage')
      usageCol.listRule = "@request.auth.id != ''"
      usageCol.viewRule = "@request.auth.id != ''"
      usageCol.createRule = "@request.auth.id != ''"
      usageCol.updateRule = "@request.auth.id != ''"
      app.save(usageCol)
    } catch (_) {}

    try {
      const syncCol = app.findCollectionByNameOrId('sync_state')
      syncCol.listRule = '@request.auth.id != ""'
      syncCol.viewRule = '@request.auth.id != ""'
      syncCol.createRule = '@request.auth.id != ""'
      syncCol.updateRule = '@request.auth.id != ""'
      syncCol.deleteRule = '@request.auth.id != ""'
      app.save(syncCol)
    } catch (_) {}
  },
)
