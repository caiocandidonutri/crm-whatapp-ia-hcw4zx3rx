/// <reference path="../pb_data/types.d.ts" />

migrate(
  (app) => {
    // Adicionar campos de Kill Switch Global em care_alert_settings:
    // global_automations_paused (bool)
    // global_automations_paused_at (date)
    // global_automations_paused_by (text)
    const col = app.findCollectionByNameOrId('care_alert_settings')

    if (!col.fields.getByName('global_automations_paused')) {
      col.fields.add(
        new BoolField({
          name: 'global_automations_paused',
          required: false,
        }),
      )
    }

    if (!col.fields.getByName('global_automations_paused_at')) {
      col.fields.add(
        new DateField({
          name: 'global_automations_paused_at',
          required: false,
        }),
      )
    }

    if (!col.fields.getByName('global_automations_paused_by')) {
      col.fields.add(
        new TextField({
          name: 'global_automations_paused_by',
          required: false,
        }),
      )
    }

    app.save(col)
  },
  (app) => {
    try {
      const col = app.findCollectionByNameOrId('care_alert_settings')
      if (col.fields.getByName('global_automations_paused')) {
        col.fields.removeByName('global_automations_paused')
      }
      if (col.fields.getByName('global_automations_paused_at')) {
        col.fields.removeByName('global_automations_paused_at')
      }
      if (col.fields.getByName('global_automations_paused_by')) {
        col.fields.removeByName('global_automations_paused_by')
      }
      app.save(col)
    } catch (_) {}
  },
)
