migrate(
  (app) => {
    const reason = 'baseline 2026-10-27'

    // Helper idempotente para salvar snapshot
    const snapshotsCol = app.findCollectionByNameOrId('baseline_snapshots')
    function recordSnapshot(accountId, colName, recId, field, oldValue) {
      // Checar se já foi gravado para esta reason
      let existing = null
      try {
        existing = app.findFirstRecordByFilter(
          'baseline_snapshots',
          'reason = {:r} && collection_name = {:c} && record_id = {:id} && field = {:f}',
          { r: reason, c: colName, id: String(recId), f: field },
        )
      } catch (_) {}

      if (!existing) {
        const snap = new Record(snapshotsCol)
        if (accountId) snap.set('account_id', accountId)
        snap.set('collection_name', colName)
        snap.set('record_id', String(recId))
        snap.set('field', field)
        snap.set('old_value', oldValue !== null && oldValue !== undefined ? String(oldValue) : '')
        snap.set('reason', reason)
        app.save(snap)
      }
    }

    const nowMs = Date.now()
    const nowSec = Math.floor(nowMs / 1000)
    const cutoff48hSec = nowSec - 48 * 3600
    const cutoff48hIso = new Date((nowSec - 48 * 3600) * 1000).toISOString().replace('T', ' ')
    const cutoff90dIso = new Date((nowSec - 90 * 86400) * 1000).toISOString().replace('T', ' ')
    const cutoff90dSec = nowSec - 90 * 86400

    // =========================================================================
    // PASSO 1: unread_count=0 em conversas
    // Regra:
    // conversas com último evento from_me OU última mensagem do paciente >48h → unread_count=0
    // EXCLUIR do reset: mensagem do paciente nas últimas 48h sem resposta humana depois
    // (as 2 conversas P-7c2a e P-3e91).
    // =========================================================================
    try {
      const convs = app.findRecordsByFilter(
        'conversations',
        'unread_count > 0',
        '-created',
        5000,
        0,
      )

      for (let i = 0; i < convs.length; i++) {
        const conv = convs[i]
        const remoteJid = conv.getString('remote_jid')
        const instanceName = conv.getString('instance_name')
        const accId = conv.getString('account_id')
        const curUnread = conv.getInt('unread_count')

        // Buscar última mensagem trocada nesta conversa
        let lastMsg = null
        try {
          const msgs = app.findRecordsByFilter(
            'whatsapp_messages',
            'instance_name = {:inst} && remote_jid = {:jid}',
            '-timestamp',
            1,
            0,
            { inst: instanceName, jid: remoteJid },
          )
          if (msgs.length > 0) {
            lastMsg = msgs[0]
          }
        } catch (_) {}

        let shouldReset = false

        if (!lastMsg) {
          // Sem mensagem registrada, mas unread > 0 -> zera
          shouldReset = true
        } else {
          const isFromMe = lastMsg.getBool('from_me')
          const msgTs = lastMsg.getInt('timestamp') || 0

          if (isFromMe) {
            // Último evento from_me -> zera
            shouldReset = true
          } else {
            // Última mensagem foi do paciente (!from_me)
            if (msgTs <= cutoff48hSec) {
              // Mensagem do paciente > 48h -> zera
              shouldReset = true
            } else {
              // Mensagem do paciente nas últimas 48h sem resposta from_me -> PROTEGIDA! Fica com unread
              shouldReset = false
            }
          }
        }

        if (shouldReset) {
          recordSnapshot(accId, 'conversations', conv.id, 'unread_count', curUnread)
          conv.set('unread_count', 0)
          app.save(conv)
        }
      }
    } catch (errConv) {
      console.log('[baseline 2026-10-27] Error in Passo 1 (conversations):', errConv)
    }

    // =========================================================================
    // PASSO 3: Tasks / Pendências abertas
    // Regra:
    // tasks/pendências abertas com gatilho >48h, e de pacientes com consulta realizada/remarcada
    // → status NOVO "arquivada_baseline" (motivo+data), NUNCA "concluída".
    // Abertas nas últimas 48h ficam.
    // =========================================================================
    try {
      // Buscar todas as tasks abertas (status != 'concluida' && status != 'cancelada' && status != 'arquivada_baseline')
      const openTasks = app.findRecordsByFilter(
        'tasks',
        'status = "pendente" || status = "em_andamento"',
        '-created',
        5000,
        0,
      )

      for (let t = 0; t < openTasks.length; t++) {
        const task = openTasks[t]
        const accId = task.getString('account_id')
        const curStatus = task.getString('status')
        const createdStr = task.getString('created')
        const taskDate = new Date(createdStr).getTime()
        const isOlderThan48h = isNaN(taskDate) || taskDate <= cutoff48hSec * 1000

        // Verificar paciente associado e suas consultas
        const contactId = task.getString('crm_contact_id')
        let hasRealizadaOuRemarcada = false

        if (contactId) {
          try {
            const appts = app.findRecordsByFilter(
              'appointments',
              'patient_id = {:pid}',
              '-starts_at',
              50,
              0,
              { pid: contactId },
            )
            for (let a = 0; a < appts.length; a++) {
              const st = (appts[a].getString('status') || '').toLowerCase()
              if (st === 'realizado' || st === 'remarcado') {
                hasRealizadaOuRemarcada = true
                break
              }
            }
          } catch (_) {}
        }

        // Condição: criada/gatilho > 48h E (ou OU conforme especificação: "com gatilho >48h, e de pacientes com consulta realizada/remarcada")
        // No diagnóstico da rodada anterior, as 4 pendências abertas tinham >48h e eram exatamente de pacientes com consulta realizada/remarcada.
        if (isOlderThan48h && hasRealizadaOuRemarcada) {
          recordSnapshot(accId, 'tasks', task.id, 'status', curStatus)
          recordSnapshot(
            accId,
            'tasks',
            task.id,
            'description',
            task.getString('description') || '',
          )

          task.set('status', 'arquivada_baseline')
          const existingDesc = task.getString('description') || ''
          const archiveNote =
            '<p><em>[Arquivada Baseline 2026-10-27: pendência >48h de paciente com consulta realizada/remarcada]</em></p>'
          task.set('description', existingDesc ? existingDesc + '<br/>' + archiveNote : archiveNote)
          app.save(task)
        }
      }
    } catch (errTask) {
      console.log('[baseline 2026-10-27] Error in Passo 3 (tasks):', errTask)
    }

    // =========================================================================
    // PASSO 4: Funil Determinístico
    // Regra:
    // consulta realizada → cliente;
    // consulta futura (agendado/confirmado) → consulta_marcada (ou etapa equivalente existente);
    // sem consulta + conversa 90d → em_atendimento;
    // >90d sem contato → inativo;
    // sem consulta/conversa → lead.
    // Regra de consulta: futuro = agendado/confirmado; a_confirmar só passado.
    // =========================================================================
    try {
      // 1. Garantir que as etapas padrão existam para cada conta ativa
      // crm_stages: lead, em_atendimento, orcamento_enviado, cliente, perdido, nao_respondido, consulta_marcada, inativo
      const accounts = app.findRecordsByFilter('accounts', '', '-created', 50, 0)
      const stagesCol = app.findCollectionByNameOrId('crm_stages')

      for (let a = 0; a < accounts.length; a++) {
        const accId = accounts[a].id

        // Garantir stage "consulta_marcada"
        let stageConsulta = null
        try {
          stageConsulta = app.findFirstRecordByFilter(
            'crm_stages',
            'account_id = {:aid} && key = "consulta_marcada"',
            { aid: accId },
          )
        } catch (_) {}

        if (!stageConsulta) {
          const sc = new Record(stagesCol)
          sc.set('account_id', accId)
          sc.set('key', 'consulta_marcada')
          sc.set('label', 'Consulta Marcada')
          sc.set('color', 'blue')
          sc.set('position', 2)
          try {
            app.save(sc)
          } catch (_) {}
        }

        // Garantir stage "inativo"
        let stageInativo = null
        try {
          stageInativo = app.findFirstRecordByFilter(
            'crm_stages',
            'account_id = {:aid} && key = "inativo"',
            { aid: accId },
          )
        } catch (_) {}

        if (!stageInativo) {
          const si = new Record(stagesCol)
          si.set('account_id', accId)
          si.set('key', 'inativo')
          si.set('label', 'Inativo')
          si.set('color', 'slate')
          si.set('position', 6)
          try {
            app.save(si)
          } catch (_) {}
        }
      }

      // 2. Classificar cada crm_contact de acordo com o funil determinístico
      const contacts = app.findRecordsByFilter('crm_contacts', '', '-created', 5000, 0)
      const nowIso = new Date(nowMs).toISOString()

      for (let c = 0; c < contacts.length; c++) {
        const contact = contacts[c]
        const accId = contact.getString('account_id')
        const curStage = contact.getString('stage') || 'lead'
        const phone = (contact.getString('phone') || '').replace(/\D/g, '')
        const jid = contact.getString('jid') || ''

        // Consultar histórico de consultas deste paciente
        let appointments = []
        try {
          appointments = app.findRecordsByFilter(
            'appointments',
            'patient_id = {:pid}',
            '-starts_at',
            100,
            0,
            { pid: contact.id },
          )
        } catch (_) {}

        // Fallback por telefone se não vinculado por patient_id
        if (appointments.length === 0 && phone && phone.length >= 8) {
          try {
            const phoneSuffix = phone.slice(-8)
            appointments = app.findRecordsByFilter(
              'appointments',
              'patient_phone ~ {:suffix}',
              '-starts_at',
              100,
              0,
              { suffix: phoneSuffix },
            )
          } catch (_) {}
        }

        let hasRealizada = false
        let hasFutura = false

        for (let ap = 0; ap < appointments.length; ap++) {
          const apt = appointments[ap]
          const st = (apt.getString('status') || '').toLowerCase()
          const startsAt = apt.getString('starts_at') || ''

          if (st === 'realizado') {
            hasRealizada = true
          }

          // Consulta futura: status agendado ou confirmado E starts_at >= agora
          if ((st === 'agendado' || st === 'confirmado') && startsAt >= nowIso) {
            hasFutura = true
          }
        }

        let targetStage = curStage

        if (hasRealizada) {
          targetStage = 'cliente'
        } else if (hasFutura) {
          targetStage = 'consulta_marcada'
        } else {
          // Sem consulta realizada nem futura. Verificar histórico de conversas / mensagens
          let lastInteractionTs = 0

          // Verificar última mensagem
          if (jid) {
            try {
              const msgs = app.findRecordsByFilter(
                'whatsapp_messages',
                'remote_jid = {:jid}',
                '-timestamp',
                1,
                0,
                { jid: jid },
              )
              if (msgs.length > 0) {
                lastInteractionTs = msgs[0].getInt('timestamp') || 0
              }
            } catch (_) {}
          }

          // Se não achou na mensagem, checar last_synced_at do contato ou updated da conversa
          if (!lastInteractionTs) {
            const syncStr = contact.getString('last_synced_at')
            if (syncStr) {
              const parsed = new Date(syncStr).getTime()
              if (!isNaN(parsed)) lastInteractionTs = Math.floor(parsed / 1000)
            }
          }

          if (lastInteractionTs === 0) {
            // Sem consulta e sem conversa
            targetStage = 'lead'
          } else if (lastInteractionTs >= cutoff90dSec) {
            // Sem consulta + conversa nos últimos 90d
            targetStage = 'em_atendimento'
          } else {
            // >90d sem contato
            targetStage = 'inativo'
          }
        }

        if (targetStage !== curStage) {
          recordSnapshot(accId, 'crm_contacts', contact.id, 'stage', curStage)
          contact.set('stage', targetStage)
          if (targetStage === 'cliente' && !contact.getBool('is_patient')) {
            recordSnapshot(accId, 'crm_contacts', contact.id, 'is_patient', 'false')
            contact.set('is_patient', true)
          }
          app.save(contact)
        }
      }
    } catch (errFunnel) {
      console.log('[baseline 2026-10-27] Error in Passo 4 (funnel):', errFunnel)
    }
  },
  (app) => {
    // Revert logic se migração for revertida
    const reason = 'baseline 2026-10-27'
    try {
      const snaps = app.findRecordsByFilter(
        'baseline_snapshots',
        'reason = {:r}',
        '-created',
        5000,
        0,
        { r: reason },
      )
      for (let i = 0; i < snaps.length; i++) {
        const snap = snaps[i]
        const col = snap.getString('collection_name')
        const recId = snap.getString('record_id')
        const field = snap.getString('field')
        const oldVal = snap.getString('old_value')
        try {
          const rec = app.findRecordById(col, recId)
          if (rec) {
            if (field === 'unread_count') {
              rec.set(field, parseInt(oldVal || '0', 10))
            } else if (field === 'is_patient') {
              rec.set(field, oldVal === 'true')
            } else {
              rec.set(field, oldVal)
            }
            app.save(rec)
          }
        } catch (_) {}
      }
    } catch (_) {}
  },
)
