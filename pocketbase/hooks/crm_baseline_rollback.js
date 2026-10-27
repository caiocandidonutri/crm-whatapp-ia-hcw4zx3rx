// Rota de reversão do baseline: POST /backend/v1/crm/baseline-rollback
// Autenticação: X-CRM-Token existente ou superuser / admin da conta.
// Sem acesso público.
// Lê baseline_snapshots reason="baseline 2026-10-27" e restaura old_value.

routerAdd('POST', '/backend/v1/crm/baseline-rollback', (e) => {
  try {
    // 1. Verificação de Autenticação: X-CRM-Token ou Auth superuser/admin
    var tokenHeader = e.request.getHeader('X-CRM-Token') || ''
    var hasValidCrmToken = tokenHeader && tokenHeader.trim() === 'crm_agenda_token_dr_caio_2026'

    var isAuthorized = false
    var callerAccount = null

    if (hasValidCrmToken) {
      isAuthorized = true
    } else if (e.auth) {
      isAuthorized = true
      try {
        var member = $app.findFirstRecordByFilter('account_members', 'user_id = {:uid}', {
          uid: e.auth.id,
        })
        if (member) {
          callerAccount = member.getString('account_id')
        }
      } catch (_) {}
    }

    if (!isAuthorized) {
      return e.json(401, {
        error: 'Acesso não autorizado. Envie X-CRM-Token válido ou autenticação com permissão.',
      })
    }

    // Se especificada reason no payload ou query, usar (default para 'plataforma-limpa' ou 'baseline 2026-10-27')
    var body = {}
    try {
      var rawBody = e.request.body ? e.request.body() : null
      if (rawBody) {
        body = JSON.parse(rawBody)
      }
    } catch (_) {}

    var targetReason =
      (body && body.reason) || e.request.url.query().get('reason') || 'plataforma-limpa'
    var filter = 'reason = {:reason}'
    var binds = { reason: targetReason }

    var targetAccount = body.account_id || callerAccount
    if (targetAccount) {
      filter += ' && account_id = {:aid}'
      binds.aid = targetAccount
    }

    // Buscar snapshots em ordem reversa de criação para desfazer coerentemente
    var snapshots = []
    try {
      snapshots = $app.findRecordsByFilter('baseline_snapshots', filter, '-created', 5000, 0, binds)
    } catch (findErr) {
      return e.json(500, { error: 'Erro ao buscar snapshots: ' + String(findErr) })
    }

    if (!snapshots || snapshots.length === 0) {
      return e.json(200, {
        message: 'Nenhum snapshot encontrado para reverter.',
        reason: reason,
        restored_count: 0,
      })
    }

    var restoredCount = 0
    var skippedCount = 0
    var errors = []

    for (var i = 0; i < snapshots.length; i++) {
      var snap = snapshots[i]
      var colName = snap.getString('collection_name')
      var recId = snap.getString('record_id')
      var field = snap.getString('field')
      var oldValue = snap.getString('old_value')

      try {
        var targetRec = $app.findRecordById(colName, recId)
        if (!targetRec) {
          skippedCount++
          continue
        }

        // Converter tipos conforme o campo
        if (field === 'unread_count') {
          targetRec.set(field, parseInt(oldValue || '0', 10))
        } else {
          targetRec.set(field, oldValue)
        }

        $app.save(targetRec)
        restoredCount++
      } catch (itemErr) {
        errors.push({
          collection: colName,
          record_id: recId,
          field: field,
          error: String(itemErr),
        })
      }
    }

    return e.json(200, {
      message: 'Rollback do baseline executado com sucesso.',
      reason: reason,
      total_snapshots: snapshots.length,
      restored_count: restoredCount,
      skipped_count: skippedCount,
      errors_count: errors.length,
      errors: errors.slice(0, 10),
    })
  } catch (err) {
    $app.logger().error('baseline_rollback fatal error', 'error', String(err))
    return e.json(500, { error: 'Erro fatal ao processar rollback: ' + String(err) })
  }
})
