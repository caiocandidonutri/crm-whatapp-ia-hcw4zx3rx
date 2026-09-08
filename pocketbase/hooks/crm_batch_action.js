routerAdd(
  'POST',
  '/backend/v1/crm/batch-action',
  (e) => {
    try {
      var userId = e.auth && e.auth.id
      if (!userId) {
        return e.json(401, { error: 'Autenticação necessária' })
      }

      var accountId = ''
      try {
        var member = $app.findFirstRecordByFilter('account_members', 'user_id = {:uid}', {
          uid: userId,
        })
        accountId = member.getString('account_id')
      } catch (_) {}

      var body = e.requestInfo().body || {}
      var contactIds = body.contact_ids || []
      var actionType = body.action_type // 'stage' | 'care_status' | 'archive' | 'unarchive'
      var targetValue = body.target_value // ex: 'lead', 'em_dia', etc.

      if (!Array.isArray(contactIds) || contactIds.length === 0) {
        return e.json(400, { error: 'Nenhum contato selecionado' })
      }

      if (!actionType) {
        return e.json(400, { error: 'Tipo de ação em lote não especificado' })
      }

      var nowIso = new Date().toISOString().replace('T', ' ')
      var updatedCount = 0
      var errorsCount = 0

      for (var i = 0; i < contactIds.length; i++) {
        var cId = contactIds[i]
        try {
          var contact = $app.findRecordById('crm_contacts', cId)
          if (!contact) continue

          // Validação de acesso à conta se accountId existir
          var cAccountId = contact.getString('account_id')
          if (accountId && cAccountId && cAccountId !== accountId) {
            continue
          }

          var changed = false

          if (actionType === 'stage' && targetValue) {
            contact.set('stage', targetValue)
            changed = true
          } else if (actionType === 'care_status' && targetValue) {
            contact.set('care_status', targetValue)
            changed = true
          } else if (actionType === 'archive') {
            contact.set('archived', true)
            changed = true
          } else if (actionType === 'unarchive') {
            contact.set('archived', false)
            changed = true
          }

          if (changed) {
            contact.set('last_synced_at', nowIso)
            $app.saveNoValidate(contact)
            updatedCount++

            // Se alterou stage ou care_status, sincronizar tarefas associadas
            if (actionType === 'care_status' && targetValue === 'em_dia') {
              try {
                var pendingTasks = $app.findRecordsByFilter(
                  'tasks',
                  "crm_contact_id = {:cid} && status != 'concluida' && status != 'cancelada'",
                  '-created',
                  10,
                  0,
                  { cid: cId },
                )
                for (var t = 0; t < pendingTasks.length; t++) {
                  pendingTasks[t].set('status', 'concluida')
                  pendingTasks[t].set('completed_at', nowIso)
                  $app.saveNoValidate(pendingTasks[t])
                }
              } catch (_) {}
            }
          }
        } catch (errOne) {
          errorsCount++
          $app.logger().warn('batch_action_contact_failed', 'id', cId, 'error', String(errOne))
        }
      }

      $app
        .logger()
        .info(
          'batch_action_completed',
          'action',
          actionType,
          'updated',
          updatedCount,
          'errors',
          errorsCount,
        )

      return e.json(200, {
        success: true,
        action: actionType,
        updated_count: updatedCount,
        errors_count: errorsCount,
      })
    } catch (err) {
      $app.logger().error('crm-batch-action error', 'error', String(err))
      return e.json(500, { error: 'Erro ao executar ação em lote' })
    }
  },
  $apis.requireAuth(),
)
