/// <reference path="../pb_data/types.d.ts" />

migrate(
  (app) => {
    // 1. Adicionar campos de controle de lembretes na coleção appointments
    const appointmentsCol = app.findCollectionByNameOrId('appointments')

    // confirmation_sent_at: timestamp de quando a confirmação 24h foi disparada
    if (!appointmentsCol.fields.getByName('confirmation_sent_at')) {
      appointmentsCol.fields.add(
        new DateField({
          name: 'confirmation_sent_at',
          required: false,
        }),
      )
    }

    // reminder_day_sent_at: timestamp de quando o lembrete do dia foi disparada
    if (!appointmentsCol.fields.getByName('reminder_day_sent_at')) {
      appointmentsCol.fields.add(
        new DateField({
          name: 'reminder_day_sent_at',
          required: false,
        }),
      )
    }

    // followup_sent_at: timestamp de quando o 1 follow-up leve de confirmação foi disparado
    if (!appointmentsCol.fields.getByName('followup_sent_at')) {
      appointmentsCol.fields.add(
        new DateField({
          name: 'followup_sent_at',
          required: false,
        }),
      )
    }

    // task_created_at: timestamp de quando a tarefa humana para a central de cuidado foi criada
    if (!appointmentsCol.fields.getByName('task_created_at')) {
      appointmentsCol.fields.add(
        new DateField({
          name: 'task_created_at',
          required: false,
        }),
      )
    }

    // last_interaction_type: armazena 'confirmacao_24h' | 'lembrete_dia' | 'followup_6h' | 'confirmado_paciente' | 'remarcado_paciente'
    if (!appointmentsCol.fields.getByName('last_interaction_type')) {
      appointmentsCol.fields.add(
        new TextField({
          name: 'last_interaction_type',
          required: false,
        }),
      )
    }

    app.save(appointmentsCol)

    // 2. Adicionar campos de controle de recall na coleção crm_contacts
    const crmContactsCol = app.findCollectionByNameOrId('crm_contacts')
    if (!crmContactsCol.fields.getByName('last_recall_sent_at')) {
      crmContactsCol.fields.add(
        new DateField({
          name: 'last_recall_sent_at',
          required: false,
        }),
      )
    }
    if (!crmContactsCol.fields.getByName('recall_count')) {
      crmContactsCol.fields.add(
        new NumberField({
          name: 'recall_count',
          required: false,
        }),
      )
    }
    app.save(crmContactsCol)

    // 3. Adicionar campos de configuração de lembretes e recall em care_alert_settings
    const careSettingsCol = app.findCollectionByNameOrId('care_alert_settings')
    if (!careSettingsCol.fields.getByName('reminders_enabled')) {
      careSettingsCol.fields.add(
        new BoolField({
          name: 'reminders_enabled',
          required: false,
        }),
      )
    }
    if (!careSettingsCol.fields.getByName('recall_enabled')) {
      careSettingsCol.fields.add(
        new BoolField({
          name: 'recall_enabled',
          required: false,
        }),
      )
    }
    if (!careSettingsCol.fields.getByName('recall_days_inactive')) {
      careSettingsCol.fields.add(
        new NumberField({
          name: 'recall_days_inactive',
          required: false,
        }),
      )
    }
    if (!careSettingsCol.fields.getByName('recall_daily_limit')) {
      careSettingsCol.fields.add(
        new NumberField({
          name: 'recall_daily_limit',
          required: false,
        }),
      )
    }
    app.save(careSettingsCol)
  },
  (app) => {
    try {
      const appointmentsCol = app.findCollectionByNameOrId('appointments')
      if (appointmentsCol.fields.getByName('confirmation_sent_at')) {
        appointmentsCol.fields.removeByName('confirmation_sent_at')
      }
      if (appointmentsCol.fields.getByName('reminder_day_sent_at')) {
        appointmentsCol.fields.removeByName('reminder_day_sent_at')
      }
      if (appointmentsCol.fields.getByName('followup_sent_at')) {
        appointmentsCol.fields.removeByName('followup_sent_at')
      }
      if (appointmentsCol.fields.getByName('task_created_at')) {
        appointmentsCol.fields.removeByName('task_created_at')
      }
      if (appointmentsCol.fields.getByName('last_interaction_type')) {
        appointmentsCol.fields.removeByName('last_interaction_type')
      }
      app.save(appointmentsCol)
    } catch (_) {}

    try {
      const crmContactsCol = app.findCollectionByNameOrId('crm_contacts')
      if (crmContactsCol.fields.getByName('last_recall_sent_at')) {
        crmContactsCol.fields.removeByName('last_recall_sent_at')
      }
      if (crmContactsCol.fields.getByName('recall_count')) {
        crmContactsCol.fields.removeByName('recall_count')
      }
      app.save(crmContactsCol)
    } catch (_) {}

    try {
      const careSettingsCol = app.findCollectionByNameOrId('care_alert_settings')
      if (careSettingsCol.fields.getByName('reminders_enabled')) {
        careSettingsCol.fields.removeByName('reminders_enabled')
      }
      if (careSettingsCol.fields.getByName('recall_enabled')) {
        careSettingsCol.fields.removeByName('recall_enabled')
      }
      if (careSettingsCol.fields.getByName('recall_days_inactive')) {
        careSettingsCol.fields.removeByName('recall_days_inactive')
      }
      if (careSettingsCol.fields.getByName('recall_daily_limit')) {
        careSettingsCol.fields.removeByName('recall_daily_limit')
      }
      app.save(careSettingsCol)
    } catch (_) {}
  },
)
