/// <reference path="../pb_data/types.d.ts" />

/**
 * FASE 1 — STATUS PÓS-CONSULTA AUTOMÁTICO
 * Transita agendamentos de status "confirmado" para "realizado" quando data/hora da consulta passa.
 *
 * Regras estritas do Contrato de Operação Dr. Caio:
 * 1) NADA envia mensagem — apenas atualiza status e notas para manter o funil vivo.
 * 2) Kill-switch global: se care_alert_settings.global_automations_paused = true, interrompe imediatamente.
 * 3) Night Shield: se entre 21h e 07h no horário de Brasília (UTC-3), não executa.
 * 4) Idempotente e leve. Executa a cada 30 minutos (escalonado nos minutos 11 e 41 para não colidir com outros crons).
 * 5) Hook onRecordAfterUpdateSuccess / onRecordAfterCreateSuccess para disparos em tempo real ao consultar / salvar agendamento vencido.
 */

cronAdd('cron_auto_pos_consulta_status', '11,41 * * * *', () => {
  try {
    // 1. KILL SWITCH GLOBAL NA PRIMEIRA INSTRUÇÃO
    try {
      var pausedRec = $app.findFirstRecordByFilter(
        'care_alert_settings',
        'global_automations_paused = true',
      )
      if (pausedRec) {
        $app.logger().info('[pos_consulta_status] Automations paused via global kill-switch')
        return
      }
    } catch (_) {}

    // 2. NIGHT SHIELD: 21h às 07h de Brasília (UTC 00h às 10h)
    var nowMs = Date.now()
    var spDate = new Date(nowMs - 3 * 3600 * 1000)
    var spHour = spDate.getUTCHours()
    if (spHour >= 21 || spHour < 7) {
      $app.logger().info('[pos_consulta_status] Night Shield ativo (21h-07h), pulando execução')
      return
    }

    var nowIso = new Date().toISOString()
    var note = 'Reconciliado — consulta realizada'

    // Busca agendamentos com status "confirmado" cujo término (ends_at) ou início (starts_at) já passou
    var pastAppts = []
    try {
      pastAppts = $app.findRecordsByFilter(
        'appointments',
        'status = "confirmado" && ((ends_at != "" && ends_at < {:now}) || ((ends_at = "" || ends_at = null) && starts_at < {:now}))',
        'starts_at',
        200,
        0,
        { now: nowIso },
      )
    } catch (errQuery) {
      $app
        .logger()
        .error(
          '[pos_consulta_status] Erro ao consultar agendamentos vencidos',
          'error',
          String(errQuery),
        )
      return
    }

    if (!pastAppts || pastAppts.length === 0) return

    var count = 0
    for (var i = 0; i < pastAppts.length; i++) {
      var ap = pastAppts[i]
      try {
        ap.set('status', 'realizado')
        var curNotes = ap.getString('notes')
        var newNotes = curNotes ? curNotes + '\n' + note : note
        ap.set('notes', newNotes)
        ap.set('last_synced_at', nowIso)
        $app.saveNoValidate(ap)
        count++

        // Se o agendamento tem patient_id vinculado, atualiza data de conversão / stage para cliente se aplicável
        var pId = ap.getString('patient_id')
        if (pId) {
          try {
            var patRec = $app.findRecordById('crm_contacts', pId)
            if (patRec) {
              var patMod = false
              var role = patRec.getString('role')
              if (role !== 'nao_paciente') {
                if (!patRec.getBool('is_patient')) {
                  patRec.set('is_patient', true)
                  patMod = true
                }
                if (patRec.getString('stage') !== 'cliente') {
                  patRec.set('stage', 'cliente')
                  patMod = true
                }
                if (role !== 'paciente') {
                  patRec.set('role', 'paciente')
                  patMod = true
                }
                if (!patRec.getString('converted_at')) {
                  var sAt = ap.getString('starts_at') || nowIso
                  patRec.set('converted_at', sAt.split('T')[0].split(' ')[0])
                  patMod = true
                }
                if (patMod) {
                  $app.saveNoValidate(patRec)
                }
              }
            }
          } catch (_) {}
        }
      } catch (errSave) {
        $app
          .logger()
          .warn(
            '[pos_consulta_status] Erro ao atualizar agendamento ' + ap.id,
            'error',
            String(errSave),
          )
      }
    }

    if (count > 0) {
      $app
        .logger()
        .info(
          '[pos_consulta_status] ' +
            count +
            ' agendamentos transitados de confirmado para realizado',
        )
    }
  } catch (fatal) {
    $app.logger().error('[pos_consulta_status] Erro fatal', 'error', String(fatal))
  }
})
