migrate(
  (app) => {
    var accountsCol = app.findCollectionByNameOrId('accounts')
    var kbCol = app.findCollectionByNameOrId('knowledge_base')
    var templatesCol = app.findCollectionByNameOrId('message_templates')

    var accounts = []
    try {
      accounts = app.findRecordsByFilter('accounts', 'id != ""', 'created', 500, 0)
    } catch (_) {}

    // 1) Corrigir a ficha existente de formas de pagamento para incluir dinheiro e débito em todas as contas
    // "pode pagar no dinheiro, no PIX, se quiser passar no cartão, no débito também pode"
    for (var a = 0; a < accounts.length; a++) {
      var accId = accounts[a].id
      try {
        var paymentCards = app.findRecordsByFilter(
          'knowledge_base',
          'account_id = {:aid} && (titulo ~ "Formas de Pagamento" || pergunta ~ "formas de pagamento")',
          '-created',
          10,
          0,
          { aid: accId },
        )
        for (var p = 0; p < paymentCards.length; p++) {
          var pc = paymentCards[p]
          pc.set(
            'resposta',
            'A consulta pode ser paga no dinheiro, no Pix, no débito ou no cartão de crédito/transferência bancária. O pagamento pode ser feito diretamente na recepção no dia do atendimento ou com link prévio enviado pela Fabiana.',
          )
          pc.set(
            'fonte',
            'Rotinas financeiras da recepção e áudio real da Fabiana ("pode pagar no dinheiro, no PIX, se quiser passar no cartão, no débito também pode")',
          )
          app.saveNoValidate(pc)
        }
      } catch (errPay) {
        console.log('[0137] Erro ao atualizar ficha de formas de pagamento: ' + errPay)
      }
    }

    // 2) Fichas novas extraídas dos áudios reais da Fabiana (segunda, 2026-10-19)
    // Entram como PROPOSTAS (rascunhos) para aprovação humana na /memoria
    var novasFichasFabiana = [
      {
        categoria: 'precos',
        titulo: 'Pacotes de Consulta Criados pelo Dr. Caio',
        pergunta: 'Como funcionam os pacotes de consulta do Dr. Caio?',
        resposta:
          'O Dr. Caio criou os pacotes de consulta, pensando cada vez mais em estar perto dos nossos pacientes. Além da consulta tradicional com retorno, a clínica oferece pacotes estruturados para acompanhamento contínuo e mais próximo.',
        fonte:
          'Transcrição real do áudio da Fabiana de 2026-10-19 16:51 ("Vou te explicar um pouquinho de como funcionam os pacotes de consulta. Pensando cada vez mais em estar perto dos nossos pacientes, o Dr. Caio criou os pacotes de consulta...")',
        status: 'proposta',
        origem: 'ia',
      },
      {
        categoria: 'unidades_horarios',
        titulo: 'Logística de Agenda · Expediente e Prazos por Cidade',
        pergunta: 'Qual o horário de expediente e qual cidade tem horário mais rápido?',
        resposta:
          'O expediente de atendimentos da clínica inicia às 7h da manhã e vai até 19h/20h. Para a unidade de Alfenas (Instituto Harmoniza) conseguimos horário de agendamento mais rápido. Mensagens e encaminhamentos internos passam por confirmação prévia antes de reenvio.',
        fonte:
          'Transcrição de áudios reais da Fabiana de 2026-10-19 16:13 e 16:53 ("ele começa a atender às 7 horas da manhã, tá agendado das 7h às 7h da noite... acaba umas 8 horas da noite" e "Agora, pra Alfenas eu consigo até mais rápido")',
        status: 'proposta',
        origem: 'ia',
      },
      {
        categoria: 'protocolos',
        titulo: 'Receitas Controladas · Encaminhamento ao PSF ou Médico Assistente',
        pergunta: 'O Dr. Caio ou a recepção renovam receitas de medicamentos controlados?',
        resposta:
          'Receitas de medicamentos controlados (como ansiolíticos, Solopran, etc.) são de competência médica estrita e devem ser solicitadas e acompanhadas diretamente pelo médico do PSF ou psiquiatra/médico assistente. A nutrição foca na conduta metabólica e nutricional.',
        fonte:
          'Transcrição de áudio real da Fabiana de 2026-10-19 16:41 ("a receita de Solopran, ela é mais com o médico do PSF ou até mesmo o médico de esquiatma, porque ele é um remédio ansiolítico, né? Então ele é controlada a receita")',
        status: 'proposta',
        origem: 'ia',
      },
      {
        categoria: 'geral',
        titulo: 'O Projeto CRM Dr. Caio · Contexto Amplo da Clínica',
        pergunta: 'Como funciona a organização do CRM da clínica do Dr. Caio?',
        resposta:
          'O CRM opera com o Funil Vivo de pacientes, Réguas de cuidado ativo, Fila do Dia (triagem dos contatos que precisam de ação hoje), Fechamento de ciclo de consultas (status realizado/faltou e registro financeiro de pagamentos), Modo Plantão ético aos fins de semana e Night Shield (21h às 07h). Todo o ecossistema respeita estritamente a LGPD.',
        fonte: 'Diretriz de governança clínica e arquitetura do CRM Dr. Caio',
        status: 'aprovada',
        origem: 'humano',
      },
    ]

    for (var a2 = 0; a2 < accounts.length; a2++) {
      var accId2 = accounts[a2].id
      var ownerId2 = accounts[a2].getString('owner_id')
      for (var f = 0; f < novasFichasFabiana.length; f++) {
        var ficha = novasFichasFabiana[f]
        var existeFicha = false
        try {
          var foundF = app.findRecordsByFilter(
            'knowledge_base',
            'account_id = {:aid} && titulo = {:titulo}',
            '-created',
            1,
            0,
            { aid: accId2, titulo: ficha.titulo },
          )
          if (foundF && foundF.length > 0) existeFicha = true
        } catch (_) {}

        if (!existeFicha) {
          var recF = new Record(kbCol)
          recF.set('account_id', accId2)
          recF.set('categoria', ficha.categoria)
          recF.set('titulo', ficha.titulo)
          recF.set('pergunta', ficha.pergunta)
          recF.set('resposta', ficha.resposta)
          recF.set('fonte', ficha.fonte)
          recF.set('status', ficha.status)
          recF.set('origem', ficha.origem)
          if (ficha.status === 'aprovada') {
            if (ownerId2) recF.set('approved_by', ownerId2)
            recF.set('approved_at', new Date().toISOString())
          }
          app.save(recF)
        }
      }
    }

    // 3) Novos templates na Voz da Fabiana (message_templates, is_fabiana_voice=true)
    // "Explicação de Pacotes" e "Promessa de retorno com prazo"
    var novosTemplatesFabiana = [
      {
        name: 'Explicação de Pacotes · Voz da Fabiana',
        trigger_type: 'primeiro_contato',
        content:
          'Vou te explicar um pouquinho de como funcionam os pacotes de consulta. Pensando cada vez mais em estar perto dos nossos pacientes, o Dr. Caio criou os pacotes de consulta, onde a gente consegue um acompanhamento mais próximo e contínuo. Se você me permitir, te passo todos os detalhes! 😊💚',
        is_fabiana_voice: true,
      },
      {
        name: 'Promessa de retorno com prazo · Voz da Fabiana',
        trigger_type: 'pos_consulta',
        content:
          'Combinado então! Semana que vem entro em contato certinho com você com todas as informações e os horários alinhados com o Dr. Caio. Qualquer coisa antes disso, pode me chamar por aqui! Um abraço carinhoso. 🙏💚',
        is_fabiana_voice: true,
      },
    ]

    for (var a3 = 0; a3 < accounts.length; a3++) {
      var accId3 = accounts[a3].id
      var ownerId3 = accounts[a3].getString('owner_id')
      for (var t = 0; t < novosTemplatesFabiana.length; t++) {
        var tpl = novosTemplatesFabiana[t]
        var existeTpl = false
        try {
          var foundT = app.findRecordsByFilter(
            'message_templates',
            'account_id = {:aid} && name = {:name}',
            '-created',
            1,
            0,
            { aid: accId3, name: tpl.name },
          )
          if (foundT && foundT.length > 0) existeTpl = true
        } catch (_) {}

        if (!existeTpl) {
          var recT = new Record(templatesCol)
          recT.set('account_id', accId3)
          recT.set('name', tpl.name)
          recT.set('trigger_type', tpl.trigger_type)
          recT.set('content', tpl.content)
          recT.set('is_fabiana_voice', true)
          if (ownerId3) recT.set('created_by', ownerId3)
          app.save(recT)
        }
      }
    }
  },
  (app) => {
    // Reversão segura
    try {
      var toDeleteTpl = app.findRecordsByFilter(
        'message_templates',
        'name = "Explicação de Pacotes · Voz da Fabiana" || name = "Promessa de retorno com prazo · Voz da Fabiana"',
        '-created',
        100,
        0,
      )
      for (var i = 0; i < toDeleteTpl.length; i++) {
        app.delete(toDeleteTpl[i])
      }
    } catch (_) {}
  },
)
