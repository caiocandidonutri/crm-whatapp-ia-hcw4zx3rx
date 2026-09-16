/// <reference path="../pb_data/types.d.ts" />

/**
 * Migration 0104: Obter o payload real da agenda externa e gravar em sync_state
 * para inspecionarmos o formato exato dos campos retornados por /backend/v1/crm-dados
 */
migrate(
  (app) => {
    try {
      var syncState = app.findFirstRecordByFilter('sync_state', 'key = {:k}', {
        k: 'agenda_externa_dr_caio',
      })
      if (syncState) {
        var existingDetails = {}
        try {
          existingDetails = JSON.parse(syncState.getString('details'))
        } catch (_) {}

        var token = (
          $secrets.get('AGENDA_CRM_TOKEN') ||
          $os.getenv('AGENDA_CRM_TOKEN') ||
          'crm_agenda_token_dr_caio_2026'
        ).trim()
        var targetUrl =
          'https://clinicapro-gestao-clone-35d33.shrd00.internal.goskip.dev/backend/v1/crm-dados?tipo=tudo&data_inicio=01/01/2026&data_fim=31/12/2026'

        // Em migrações, $secrets e $os.getenv funcionam. No entanto, $http só está disponível nos hooks e runtime do PocketBase.
        // Registramos aqui o pedido de diagnóstico ampliado para o hook carregar.
        existingDetails.migration_0104_note = 'Aguardando probe via hook'
        syncState.set('details', JSON.stringify(existingDetails))
        app.save(syncState)
      }
    } catch (e) {
      console.log('Migration 0104 error:', e)
    }
  },
  (app) => {},
)
