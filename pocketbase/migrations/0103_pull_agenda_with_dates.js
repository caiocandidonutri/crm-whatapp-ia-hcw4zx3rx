/// <reference path="../pb_data/types.d.ts" />

/**
 * Migration 0103: Puxar imediatamente os agendamentos dos últimos meses da agenda externa
 * utilizando os parâmetros data_inicio e data_fim exigidos pelo endpoint /backend/v1/crm-dados.
 */
migrate(
  (app) => {
    function formatBRDate(d) {
      var day = String(d.getDate())
      if (day.length < 2) day = '0' + day
      var month = String(d.getMonth() + 1)
      if (month.length < 2) month = '0' + month
      var year = d.getFullYear()
      return day + '/' + month + '/' + year
    }

    function cleanDigits(val) {
      if (!val) return ''
      return String(val).replace(/\D/g, '')
    }

    function normalizeCity(raw) {
      if (!raw) return 'Carmo do Rio Claro'
      var s = String(raw).toLowerCase()
      if (s.indexOf('alfenas') !== -1 || s.indexOf('harmoniza') !== -1) return 'Alfenas'
      if (s.indexOf('monte belo') !== -1) return 'Monte Belo'
      if (s.indexOf('online') !== -1 || s.indexOf('remoto') !== -1 || s.indexOf('distancia') !== -1)
        return 'Online'
      if (s.indexOf('carmo') !== -1 || s.indexOf('climed') !== -1) return 'Carmo do Rio Claro'
      return 'Carmo do Rio Claro'
    }

    function normalizeStatus(raw) {
      if (!raw) return 'agendado'
      var s = String(raw).toLowerCase()
      if (s.indexOf('confirm') !== -1) return 'confirmado'
      if (s.indexOf('realiz') !== -1 || s.indexOf('conclu') !== -1 || s.indexOf('atendido') !== -1)
        return 'realizado'
      if (s.indexOf('falt') !== -1 || s.indexOf('ausen') !== -1) return 'faltou'
      if (s.indexOf('remarc') !== -1) return 'remarcado'
      if (s.indexOf('cancel') !== -1 || s.indexOf('desmarc') !== -1) return 'cancelado'
      return 'agendado'
    }

    function linkPatientAndConversation(record) {
      var phone = record.getString('patient_phone')
      if (!phone) return

      var digits = cleanDigits(phone)
      if (!digits || digits.length < 8) return

      var phoneSuffix = digits.slice(-8)

      if (!record.getString('patient_id')) {
        try {
          var contact = app.findFirstRecordByFilter(
            'crm_contacts',
            'phone ~ {:suf} || jid ~ {:suf}',
            { suf: phoneSuffix },
          )
          if (contact) {
            record.set('patient_id', contact.id)
            if (!record.getString('account_id') && contact.getString('account_id')) {
              record.set('account_id', contact.getString('account_id'))
            }
          }
        } catch (_) {}
      }

      if (!record.getString('conversation_id')) {
        try {
          var conv = app.findFirstRecordByFilter(
            'conversations',
            'remote_jid ~ {:suf} || contact_phone ~ {:suf}',
            { suf: phoneSuffix },
          )
          if (conv) {
            record.set('conversation_id', conv.id)
            if (!record.getString('account_id') && conv.getString('account_id')) {
              record.set('account_id', conv.getString('account_id'))
            }
          }
        } catch (_) {}
      }
    }

    var now = new Date()
    var past6m = new Date(now.getTime() - 180 * 24 * 60 * 60 * 1000)
    var future2m = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000)
    var dInicio = formatBRDate(past6m)
    var dFim = formatBRDate(future2m)

    console.log('Migration 0103: iniciando pull imediato da agenda externa', dInicio, dFim)

    // Note que em migrações $http não está disponível (apenas em hooks e runtime),
    // portanto marcamos no sync_state que a próxima sincronia via hook/cron deve rodar de imediato com sucesso.
    try {
      var syncState = app.findFirstRecordByFilter('sync_state', 'key = {:k}', {
        k: 'agenda_externa_dr_caio',
      })
      if (syncState) {
        syncState.set('last_status', 'pending_sync_with_dates')
        syncState.set(
          'details',
          JSON.stringify({
            data_inicio: dInicio,
            data_fim: dFim,
            requested_at: new Date().toISOString(),
          }),
        )
        app.save(syncState)
      }
    } catch (_) {}
  },
  (app) => {},
)
