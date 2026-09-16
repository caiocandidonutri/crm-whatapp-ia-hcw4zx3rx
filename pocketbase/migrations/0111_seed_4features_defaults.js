migrate(
  (app) => {
    // Busca contas existentes para semear dados padrão
    var accounts = []
    try {
      accounts = app.findRecordsByFilter('accounts', '', '-created', 100, 0)
    } catch (_) {}

    if (!accounts || accounts.length === 0) return

    for (var a = 0; a < accounts.length; a++) {
      var account = accounts[a]
      var accId = account.id

      // 1. Seed de Quick Replies
      var quickRepliesCol = app.findCollectionByNameOrId('quick_replies')
      var defaultReplies = [
        {
          title: 'Valores e Formas de Pagamento',
          shortcut: '/valores',
          category: 'valores',
          sort_order: 1,
          body: 'Olá! A consulta com o Dr. Caio inclui avaliação clínica nutricional completa, bioimpedância tetrapolar de alta precisão e plano alimentar 100% individualizado. O valor é R$ 250,00 (aceitamos Pix e cartão). Posso verificar os melhores horários disponíveis para você?',
        },
        {
          title: 'Unidades e Locais de Atendimento',
          shortcut: '/local',
          category: 'local',
          sort_order: 2,
          body: 'Atendemos presencialmente nas seguintes unidades:\n📍 Carmo do Rio Claro: Consultório Central\n📍 Alfenas: Instituto Harmoniza\n📍 Monte Belo: Centro Médico\nTambém realizamos consultas online com acompanhamento completo. Qual unidade fica melhor para você?',
        },
        {
          title: 'Preparo para Exame de Bioimpedância',
          shortcut: '/preparo',
          category: 'preparo',
          sort_order: 3,
          body: 'Para o exame de bioimpedância ser bem preciso, pedimos seguir estas orientações simples no dia:\n• Jejum de 2 a 3 horas de alimentos e água;\n• Evitar cafeína, energéticos e álcool nas 24h anteriores;\n• Não praticar atividade física intensa no dia;\n• Urinar cerca de 30 minutos antes da consulta.',
        },
        {
          title: 'Boas-vindas Novo Paciente',
          shortcut: '/boasvindas',
          category: 'geral',
          sort_order: 4,
          body: 'Olá! Seja muito bem-vindo(a) à clínica do Dr. Caio Cândido! Aqui cuidamos da sua saúde de forma integrada, leve e acolhedora. Como podemos te ajudar hoje?',
        },
        {
          title: 'Confirmação de Agendamento',
          shortcut: '/confirmacao',
          category: 'agendamento',
          sort_order: 5,
          body: 'Olá! Passando para confirmar seu horário agendado com o Dr. Caio. Podemos contar com sua presença? Se precisar de alguma alteração de dia ou horário, é só nos avisar por aqui!',
        },
      ]

      for (var qr = 0; qr < defaultReplies.length; qr++) {
        var replyData = defaultReplies[qr]
        try {
          var exists = app.findRecordsByFilter(
            'quick_replies',
            'account_id = {:accId} && title = {:title}',
            '-created',
            1,
            0,
            { accId: accId, title: replyData.title },
          )
          if (!exists || exists.length === 0) {
            var rec = new Record(quickRepliesCol)
            rec.set('account_id', accId)
            rec.set('title', replyData.title)
            rec.set('shortcut', replyData.shortcut)
            rec.set('category', replyData.category)
            rec.set('sort_order', replyData.sort_order)
            rec.set('body', replyData.body)
            app.save(rec)
          }
        } catch (_) {}
      }

      // 2. Seed de Business Hours (seg-sex 08:00-18:00, sáb 08:00-12:00, dom fechado)
      // dia_semana: 0=domingo, 1=segunda, 2=terça, 3=quarta, 4=quinta, 5=sexta, 6=sábado
      var businessHoursCol = app.findCollectionByNameOrId('business_hours')
      var schedule = [
        { dia: 0, ativo: false, abre: '08:00', fecha: '12:00' }, // Domingo fechado
        { dia: 1, ativo: true, abre: '08:00', fecha: '18:00' }, // Segunda
        { dia: 2, ativo: true, abre: '08:00', fecha: '18:00' }, // Terça
        { dia: 3, ativo: true, abre: '08:00', fecha: '18:00' }, // Quarta
        { dia: 4, ativo: true, abre: '08:00', fecha: '18:00' }, // Quinta
        { dia: 5, ativo: true, abre: '08:00', fecha: '18:00' }, // Sexta
        { dia: 6, ativo: true, abre: '08:00', fecha: '12:00' }, // Sábado
      ]

      for (var s = 0; s < schedule.length; s++) {
        var item = schedule[s]
        try {
          var bhExists = app.findRecordsByFilter(
            'business_hours',
            'account_id = {:accId} && dia_semana = {:dia}',
            '-created',
            1,
            0,
            { accId: accId, dia: item.dia },
          )
          if (!bhExists || bhExists.length === 0) {
            var bhRec = new Record(businessHoursCol)
            bhRec.set('account_id', accId)
            bhRec.set('dia_semana', item.dia)
            bhRec.set('ativo', item.ativo)
            bhRec.set('abre', item.abre)
            bhRec.set('fecha', item.fecha)
            bhRec.set('unidade', 'Global')
            app.save(bhRec)
          }
        } catch (_) {}
      }

      // 3. Atualizar configurações de care_alert_settings
      try {
        var careSettingsRec = app.findFirstRecordByFilter(
          'care_alert_settings',
          'account_id = {:accId}',
          { accId: accId },
        )
        if (careSettingsRec) {
          if (
            careSettingsRec.get('after_hours_enabled') === null ||
            careSettingsRec.get('after_hours_enabled') === undefined
          ) {
            careSettingsRec.set('after_hours_enabled', true)
          }
          if (
            careSettingsRec.get('survey_enabled') === null ||
            careSettingsRec.get('survey_enabled') === undefined
          ) {
            careSettingsRec.set('survey_enabled', true)
          }
          if (!careSettingsRec.getString('survey_q1')) {
            careSettingsRec.set(
              'survey_q1',
              'De 0 a 10, como foi sua experiência com a gente hoje? 💚',
            )
          }
          if (!careSettingsRec.getString('survey_q2')) {
            careSettingsRec.set('survey_q2', 'Tem algo que poderíamos melhorar no seu atendimento?')
          }
          app.save(careSettingsRec)
        }
      } catch (_) {}
    }
  },
  (app) => {},
)
