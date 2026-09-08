// Verificação periódica de integridade de dados (mensagens e conversas)
// Protege contra perda acidental ou corrupção de dados.
// NUNCA deleta registros. Apenas monitora e alerta a equipe caso haja queda brusca de contagem.

cronAdd('data_integrity_check', '0 */6 * * *', () => {
  try {
    var accounts = []
    try {
      accounts = $app.findRecordsByFilter('accounts', "id != ''", 'created', 100, 0)
    } catch (_) {}

    if (!accounts || accounts.length === 0) return

    for (var a = 0; a < accounts.length; a++) {
      var acc = accounts[a]
      var accId = acc.id

      var msgCount = 0
      try {
        var msgRows = $app.findRecordsByFilter(
          'whatsapp_messages',
          'account_id = {:accId}',
          '-created',
          1,
          0,
          {
            accId: accId,
          },
        )
        // Obter contagem aproximada rápida
        msgCount = $app.countRecords('whatsapp_messages', 'account_id = "' + accId + '"')
      } catch (_) {}

      var convCount = 0
      try {
        convCount = $app.countRecords('conversations', 'account_id = "' + accId + '"')
      } catch (_) {}

      // Log seguro apenas com contagens e IDs (sem nomes, nem telefones, nem mensagens)
      $app
        .logger()
        .info(
          'data_integrity_check',
          'account_id',
          accId,
          'messages_count',
          msgCount,
          'conversations_count',
          convCount,
        )

      // Se mensagens existirem em histórico mas forem 0 repentinamente (ou erro crítico),
      // avisar os administradores no sino com tipo 'system'
      if (convCount > 0 && msgCount === 0) {
        try {
          var members = $app.findRecordsByFilter(
            'account_members',
            'account_id = {:accId}',
            '-created',
            20,
            0,
            {
              accId: accId,
            },
          )
          var notifCol = $app.findCollectionByNameOrId('notifications')

          for (var m = 0; m < members.length; m++) {
            var uId = members[m].getString('user_id')
            if (!uId) continue

            // Evitar duplicações não lidas
            var existing = $app.findRecordsByFilter(
              'notifications',
              "user_id = {:uid} && type = 'system' && read = false && title ~ 'Integridade'",
              '-created',
              1,
              0,
              { uid: uId },
            )
            if (existing && existing.length > 0) continue

            var notif = new Record(notifCol)
            notif.set('user_id', uId)
            notif.set('account_id', accId)
            notif.set('type', 'system')
            notif.set('title', 'Alerta de Integridade de Mensagens')
            notif.set(
              'body',
              'O monitor de integridade detectou conversas ativas sem mensagens indexadas. A rotina automática de sincronização verificará o histórico.',
            )
            notif.set('read', false)
            $app.saveNoValidate(notif)
          }
        } catch (_) {}
      }
    }
  } catch (err) {
    $app.logger().error('data_integrity_check_failed', 'error', String(err))
  }
})
