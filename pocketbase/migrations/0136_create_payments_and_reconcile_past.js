migrate(
  (app) => {
    var accountsCol = app.findCollectionByNameOrId('accounts')

    // 1) Criar coleção payments (leve por atendimento)
    try {
      app.findCollectionByNameOrId('payments')
    } catch (_) {
      var appointmentsCol = app.findCollectionByNameOrId('appointments')
      var contactsCol = app.findCollectionByNameOrId('crm_contacts')

      var payCol = new Collection({
        name: 'payments',
        type: 'base',
        listRule: '@request.auth.id != ""',
        viewRule: '@request.auth.id != ""',
        createRule: '@request.auth.id != ""',
        updateRule: '@request.auth.id != ""',
        deleteRule: '@request.auth.id != ""',
        fields: [
          {
            name: 'account_id',
            type: 'relation',
            collectionId: accountsCol.id,
            cascadeDelete: true,
            maxSelect: 1,
            required: true,
          },
          {
            name: 'appointment_id',
            type: 'relation',
            collectionId: appointmentsCol.id,
            cascadeDelete: false,
            maxSelect: 1,
          },
          {
            name: 'crm_contact_id',
            type: 'relation',
            collectionId: contactsCol.id,
            cascadeDelete: false,
            maxSelect: 1,
          },
          {
            name: 'valor',
            type: 'number',
            required: true,
          },
          {
            name: 'forma_pagamento',
            type: 'select',
            required: true,
            maxSelect: 1,
            values: ['pix', 'cartao', 'dinheiro', 'transferencia'],
          },
          {
            name: 'data_pagamento',
            type: 'date',
            required: true,
          },
          {
            name: 'unidade',
            type: 'text',
          },
          {
            name: 'observacoes',
            type: 'text',
          },
          {
            name: 'created_by',
            type: 'relation',
            collectionId: '_pb_users_auth_',
            cascadeDelete: false,
            maxSelect: 1,
          },
          {
            name: 'created',
            type: 'autodate',
            onCreate: true,
            onUpdate: false,
          },
          {
            name: 'updated',
            type: 'autodate',
            onCreate: true,
            onUpdate: true,
          },
        ],
        indexes: [
          'CREATE INDEX idx_payments_account ON payments (account_id)',
          'CREATE INDEX idx_payments_appointment ON payments (appointment_id)',
          'CREATE INDEX idx_payments_data ON payments (data_pagamento)',
          'CREATE INDEX idx_payments_forma ON payments (forma_pagamento)',
        ],
      })
      app.save(payCol)
    }

    // 2) Reconciliação idempotente em lote de consultas passadas (starts_at < hoje)
    // Atualiza consultas antigas ainda marcadas como "agendado" ou "aguardando" para "realizado"
    try {
      var nowIso = new Date().toISOString()
      var pastAppts = app.findRecordsByFilter(
        'appointments',
        '(status = "agendado" || status = "aguardando" || status = "confirmado") && starts_at < {:now}',
        'starts_at',
        500,
        0,
        { now: nowIso },
      )

      for (var i = 0; i < pastAppts.length; i++) {
        var ap = pastAppts[i]
        ap.set('status', 'realizado')
        var curNotes = ap.getString('notes')
        var note = 'Reconciliado em lote — consulta passada concluída'
        ap.set('notes', curNotes ? curNotes + '\n' + note : note)
        app.saveNoValidate(ap)
      }
    } catch (errRec) {
      console.log('[migration 0136] Erro na reconciliação de consultas passadas: ' + errRec)
    }
  },
  (app) => {
    try {
      var col = app.findCollectionByNameOrId('payments')
      app.delete(col)
    } catch (_) {}
  },
)
