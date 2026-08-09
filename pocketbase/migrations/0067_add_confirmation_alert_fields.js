migrate(
  (app) => {
    var alertsCol = app.findCollectionByNameOrId('care_alerts')
    alertsCol.fields.removeByName('type')
    alertsCol.fields.add(
      new SelectField({
        name: 'type',
        required: true,
        values: ['followup', 'needs_care', 'confirmacao_24h'],
        maxSelect: 1,
      }),
    )
    app.save(alertsCol)

    var settingsCol = app.findCollectionByNameOrId('care_alert_settings')
    if (!settingsCol.fields.getByName('confirmation_alert_enabled')) {
      settingsCol.fields.add(new BoolField({ name: 'confirmation_alert_enabled', required: false }))
    }
    if (!settingsCol.fields.getByName('confirmation_hours_before')) {
      settingsCol.fields.add(
        new NumberField({
          name: 'confirmation_hours_before',
          required: false,
          onlyInt: true,
        }),
      )
    }
    app.save(settingsCol)

    try {
      var existingSettings = app.findRecordsByFilter(
        'care_alert_settings',
        'id != ""',
        '-created',
        500,
        0,
      )
      for (var i = 0; i < existingSettings.length; i++) {
        existingSettings[i].set('confirmation_alert_enabled', true)
        existingSettings[i].set('confirmation_hours_before', 24)
        app.saveNoValidate(existingSettings[i])
      }
    } catch (_) {}
  },
  (app) => {
    var alertsCol = app.findCollectionByNameOrId('care_alerts')
    alertsCol.fields.removeByName('type')
    alertsCol.fields.add(
      new SelectField({
        name: 'type',
        required: true,
        values: ['followup', 'needs_care'],
        maxSelect: 1,
      }),
    )
    app.save(alertsCol)

    var settingsCol = app.findCollectionByNameOrId('care_alert_settings')
    if (settingsCol.fields.getByName('confirmation_alert_enabled')) {
      settingsCol.fields.removeByName('confirmation_alert_enabled')
    }
    if (settingsCol.fields.getByName('confirmation_hours_before')) {
      settingsCol.fields.removeByName('confirmation_hours_before')
    }
    app.save(settingsCol)
  },
)
