/// <reference path="../pb_data/types.d.ts" />

migrate(
  (app) => {
    const careSettingsCol = app.findCollectionByNameOrId('care_alert_settings')
    const targetAccountId = 'u2cbx6yw2gm0ook'

    try {
      // Verifica se já existe para a conta do Dr. Caio
      app.findFirstRecordByData('care_alert_settings', 'account_id', targetAccountId)
      return // Já existe, nada a fazer
    } catch (_) {
      // Não existe: cria registro com defaults completos
      try {
        const record = new Record(careSettingsCol)
        record.set('account_id', targetAccountId)
        record.set('whatsapp_alert_phone', '')
        record.set('followup_alert_enabled', true)
        record.set('needs_care_alert_enabled', true)
        record.set('confirmation_alert_enabled', true)
        record.set('confirmation_hours_before', 24)
        record.set('reminders_enabled', true)
        record.set('recall_enabled', true)
        record.set('recall_days_inactive', 14)
        record.set('recall_daily_limit', 15)
        app.save(record)
      } catch (err) {
        console.log('0098_seed_care_alert_settings: falha ao salvar registro:', err)
      }
    }
  },
  (app) => {
    try {
      const record = app.findFirstRecordByData(
        'care_alert_settings',
        'account_id',
        'u2cbx6yw2gm0ook',
      )
      if (record) {
        app.delete(record)
      }
    } catch (_) {}
  },
)
