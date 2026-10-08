migrate(
  (app) => {
    // 1. Campos novos em crm_contacts:
    // - budget_value (number)
    // - budget_sent_at (date)
    // - plan_expires_at (date)
    // - is_club_member (bool)
    const contactsCol = app.findCollectionByNameOrId('crm_contacts')
    if (!contactsCol.fields.getByName('budget_value')) {
      contactsCol.fields.add(new NumberField({ name: 'budget_value' }))
    }
    if (!contactsCol.fields.getByName('budget_sent_at')) {
      contactsCol.fields.add(new DateField({ name: 'budget_sent_at' }))
    }
    if (!contactsCol.fields.getByName('plan_expires_at')) {
      contactsCol.fields.add(new DateField({ name: 'plan_expires_at' }))
    }
    if (!contactsCol.fields.getByName('is_club_member')) {
      contactsCol.fields.add(new BoolField({ name: 'is_club_member' }))
    }
    app.save(contactsCol)

    // 2. Campos novos em care_alert_settings:
    // - club_recall_days_inactive (number, default 45)
    // - budget_followup_days (number, default 7)
    // - renewal_alert_days_before (number, default 15)
    // - return_30d_rule_enabled (bool, default true)
    // - confirmation_hours_before default para 48
    const settingsCol = app.findCollectionByNameOrId('care_alert_settings')
    if (!settingsCol.fields.getByName('club_recall_days_inactive')) {
      settingsCol.fields.add(new NumberField({ name: 'club_recall_days_inactive' }))
    }
    if (!settingsCol.fields.getByName('budget_followup_days')) {
      settingsCol.fields.add(new NumberField({ name: 'budget_followup_days' }))
    }
    if (!settingsCol.fields.getByName('renewal_alert_days_before')) {
      settingsCol.fields.add(new NumberField({ name: 'renewal_alert_days_before' }))
    }
    if (!settingsCol.fields.getByName('return_30d_rule_enabled')) {
      settingsCol.fields.add(new BoolField({ name: 'return_30d_rule_enabled' }))
    }
    app.save(settingsCol)

    // Atualizar configurações existentes para confirmation_hours_before = 48 e novos padrões
    try {
      const allSettings = app.findRecordsByFilter('care_alert_settings', '', '-created', 100, 0)
      for (let s = 0; s < allSettings.length; s++) {
        const st = allSettings[s]
        if (
          !st.getInt('confirmation_hours_before') ||
          st.getInt('confirmation_hours_before') === 24
        ) {
          st.set('confirmation_hours_before', 48)
        }
        if (!st.getInt('club_recall_days_inactive')) {
          st.set('club_recall_days_inactive', 45)
        }
        if (!st.getInt('budget_followup_days')) {
          st.set('budget_followup_days', 7)
        }
        if (!st.getInt('renewal_alert_days_before')) {
          st.set('renewal_alert_days_before', 15)
        }
        if (
          st.get('return_30d_rule_enabled') === null ||
          st.get('return_30d_rule_enabled') === undefined
        ) {
          st.set('return_30d_rule_enabled', true)
        }
        app.save(st)
      }
    } catch (_) {}

    // 3. Adicionar etapa 'orcamento_enviado' ao pipeline (após em_atendimento)
    try {
      const accounts = app.findRecordsByFilter('accounts', '', '-created', 50, 0)
      for (let a = 0; a < accounts.length; a++) {
        const accId = accounts[a].id
        let existingOrc = null
        try {
          existingOrc = app.findFirstRecordByFilter(
            'crm_stages',
            'account_id = {:aid} && key = "orcamento_enviado"',
            { aid: accId },
          )
        } catch (_) {}

        if (!existingOrc) {
          // Encontrar stages atuais para reordenar
          const stages = app.findRecordsByFilter(
            'crm_stages',
            'account_id = {:aid}',
            'position',
            50,
            0,
            { aid: accId },
          )
          const stagesCol = app.findCollectionByNameOrId('crm_stages')

          // Queremos: lead (0), em_atendimento (1), orcamento_enviado (2), cliente (3), perdido (4), nao_respondido (5)
          let emAtendimentoPos = 1
          for (let i = 0; i < stages.length; i++) {
            if (stages[i].getString('key') === 'em_atendimento') {
              emAtendimentoPos = stages[i].getInt('position') || 1
              break
            }
          }

          // Shift positions >= emAtendimentoPos + 1
          for (let i = 0; i < stages.length; i++) {
            const pos = stages[i].getInt('position')
            if (pos > emAtendimentoPos) {
              stages[i].set('position', pos + 1)
              app.save(stages[i])
            }
          }

          const newStage = new Record(stagesCol)
          newStage.set('account_id', accId)
          newStage.set('key', 'orcamento_enviado')
          newStage.set('label', 'Orçamento Enviado')
          newStage.set('color', 'purple')
          newStage.set('position', emAtendimentoPos + 1)
          app.save(newStage)
        }
      }
    } catch (_) {}

    // 4. Limpeza e consolidação de care_followup_rules duplicados
    // No briefing: Consulta inicial 7d x2, Retorno SOP 15d x2, Procedimento hormonal 5d x2
    // Consolidar para 3 únicos, remapear os contatos que apontam para os duplicados e apagar os órfãos.
    try {
      const rules = app.findRecordsByFilter('care_followup_rules', '', 'created', 100, 0)
      const seenByName = {}
      for (let r = 0; r < rules.length; r++) {
        const rule = rules[r]
        const name = (rule.getString('name') || '').trim()
        const acc = rule.getString('account_id')
        const dedupeKey = acc + '___' + name.toLowerCase()

        if (!seenByName[dedupeKey]) {
          seenByName[dedupeKey] = rule.id
        } else {
          // Duplicado encontrado!
          const canonicalId = seenByName[dedupeKey]
          const duplicateId = rule.id

          // Remapear crm_contacts que apontam para o duplicado
          app
            .db()
            .newQuery(
              'UPDATE crm_contacts SET followup_rule_id = {:canonical} WHERE followup_rule_id = {:dup}',
            )
            .bind({ canonical: canonicalId, dup: duplicateId })
            .execute()

          // Apagar o registro duplicado
          app.delete(rule)
        }
      }

      // Também garantir que a nova regra 'Retorno 30d' exista para cada conta
      const accounts = app.findRecordsByFilter('accounts', '', '-created', 50, 0)
      const rulesCol = app.findCollectionByNameOrId('care_followup_rules')
      for (let a = 0; a < accounts.length; a++) {
        const accId = accounts[a].id
        let rule30 = null
        try {
          rule30 = app.findFirstRecordByFilter(
            'care_followup_rules',
            'account_id = {:aid} && followup_days = 30',
            { aid: accId },
          )
        } catch (_) {}

        if (!rule30) {
          const nr = new Record(rulesCol)
          nr.set('account_id', accId)
          nr.set('name', 'Retorno 30d')
          nr.set('followup_days', 30)
          nr.set(
            'reminder_text',
            'Olá, {nome}! Completamos 30 dias desde seu início de acompanhamento com o Dr. Caio. Como estão sua rotina e evolução? Vamos agendar seu retorno de rotina? 💚',
          )
          app.save(nr)
        }
      }
    } catch (_) {}

    // 5. Limpeza das instâncias órfãs status='qrcode'
    // Preservar estritamente a conectada: instance_1786021758855
    try {
      const orphanInstances = app.findRecordsByFilter(
        'whatsapp_instances',
        'status = "qrcode" && instance_name != "instance_1786021758855"',
        '-created',
        100,
        0,
      )
      for (let o = 0; o < orphanInstances.length; o++) {
        app.delete(orphanInstances[o])
      }
    } catch (_) {}
  },
  (app) => {
    // Revert logic
  },
)
