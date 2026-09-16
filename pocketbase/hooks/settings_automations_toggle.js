// @ts-check
/// <reference path="../pb_data/types.d.ts" />

/**
 * Endpoint POST /backend/v1/settings/automations-toggle
 * Alterna ou define o Kill Switch Global de mensagens automáticas.
 *
 * Body (opcional):
 * {
 *   "paused": boolean,       // se omitido, inverte o valor atual
 *   "account_id": string     // se omitido, usa a conta do usuário autenticado
 * }
 *
 * Retorna:
 * {
 *   "success": true,
 *   "paused": boolean,
 *   "paused_at": string | null,
 *   "paused_by": string,
 *   "account_id": string
 * }
 */

routerAdd(
  'POST',
  '/backend/v1/settings/automations-toggle',
  (e) => {
    try {
      var authRecord = e.auth
      var userId = authRecord ? authRecord.id : ''
      var userName = authRecord
        ? authRecord.getString('name') || authRecord.getString('email') || 'Usuário'
        : 'Usuário'

      var body = {}
      try {
        body = e.requestInfo().body || {}
      } catch (_) {
        body = {}
      }

      // 1. Determinar account_id
      var accountId = body.account_id || ''
      if (!accountId && authRecord) {
        try {
          accountId = authRecord.get('account_id') || ''
        } catch (_) {}
      }

      if (!accountId && userId) {
        try {
          var member = $app.findFirstRecordByFilter('account_members', 'user_id = {:uid}', {
            uid: userId,
          })
          if (member) accountId = member.getString('account_id')
        } catch (_) {}
      }

      // Se ainda não tiver accountId, busca a primeira conta existente
      if (!accountId) {
        try {
          var anyAcc = $app.findFirstRecordByFilter('accounts', '', {})
          if (anyAcc) accountId = anyAcc.id
        } catch (_) {}
      }

      if (!accountId) {
        return e.json(400, { error: 'account_id não encontrado' })
      }

      // 2. Buscar ou criar care_alert_settings da conta
      var settingsRec = null
      try {
        settingsRec = $app.findFirstRecordByFilter('care_alert_settings', 'account_id = {:aid}', {
          aid: accountId,
        })
      } catch (_) {}

      var col = $app.findCollectionByNameOrId('care_alert_settings')
      if (!settingsRec) {
        settingsRec = new Record(col)
        settingsRec.set('account_id', accountId)
        settingsRec.set('followup_alert_enabled', true)
        settingsRec.set('needs_care_alert_enabled', true)
        settingsRec.set('confirmation_alert_enabled', true)
        settingsRec.set('confirmation_hours_before', 24)
        settingsRec.set('reminders_enabled', true)
        settingsRec.set('recall_enabled', true)
        settingsRec.set('recall_days_inactive', 14)
        settingsRec.set('recall_daily_limit', 15)
        settingsRec.set('after_hours_enabled', true)
        settingsRec.set('survey_enabled', true)
      }

      var currentPaused = false
      try {
        currentPaused = settingsRec.getBool('global_automations_paused')
      } catch (_) {
        currentPaused = false
      }

      var nextPaused = typeof body.paused === 'boolean' ? body.paused : !currentPaused

      var nowIso = new Date().toISOString()
      settingsRec.set('global_automations_paused', nextPaused)
      if (nextPaused) {
        settingsRec.set('global_automations_paused_at', nowIso)
        settingsRec.set('global_automations_paused_by', userName)

        // Limpeza de fila de respostas pendentes de IA ao pausar (pending_ai_response = false)
        try {
          var pendingFilter = 'pending_ai_response = true'
          if (accountId) {
            pendingFilter = 'account_id = "' + accountId + '" && pending_ai_response = true'
          }
          var pendingMsgs = $app.findRecordsByFilter(
            'whatsapp_messages',
            pendingFilter,
            '-created',
            500,
            0,
          )
          if (pendingMsgs && pendingMsgs.length > 0) {
            for (var p = 0; p < pendingMsgs.length; p++) {
              pendingMsgs[p].set('pending_ai_response', false)
              $app.saveNoValidate(pendingMsgs[p])
            }
            $app
              .logger()
              .info(
                'automations_toggle: cleared pending_ai_response queue',
                'count',
                pendingMsgs.length,
              )
          }
        } catch (cleanErr) {
          $app
            .logger()
            .warn('automations_toggle: error clearing pending queue', 'err', String(cleanErr))
        }
      } else {
        settingsRec.set('global_automations_paused_at', null)
        settingsRec.set('global_automations_paused_by', '')
      }

      $app.save(settingsRec)

      $app
        .logger()
        .info(
          'automations_kill_switch_toggled',
          'account_id',
          accountId,
          'paused',
          nextPaused,
          'by',
          userName,
        )

      return e.json(200, {
        success: true,
        paused: nextPaused,
        paused_at: nextPaused ? nowIso : null,
        paused_by: nextPaused ? userName : '',
        account_id: accountId,
      })
    } catch (err) {
      $app.logger().error('automations_toggle_error', 'err', String(err))
      return e.json(500, { error: 'Erro ao alternar automações: ' + String(err) })
    }
  },
  $apis.requireAuth(),
)
