// Migração: outbox_marks passa a ser acessível apenas server-side (hooks).
// listRule/viewRule/createRule/updateRule = null (nulo = somente admins/superuser,
// nenhum cliente autenticado comum). deleteRule permanece para o cron de limpeza.
migrate(
  (app) => {
    const col = app.findCollectionByNameOrId('outbox_marks')
    col.listRule = null
    col.viewRule = null
    col.createRule = null
    col.updateRule = null
    // deleteRule: permanece como está (usado pelo cron de limpeza de >7 dias)
    app.save(col)
  },
  (app) => {
    const col = app.findCollectionByNameOrId('outbox_marks')
    col.listRule = '@request.auth.id != ""'
    col.viewRule = '@request.auth.id != ""'
    col.createRule = '@request.auth.id != ""'
    col.updateRule = '@request.auth.id != ""'
    app.save(col)
  },
)
