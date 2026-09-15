/// <reference path="../pb_data/types.d.ts" />
migrate(
  (app) => {
    // 1. Coleção sync_state (para metadados de sincronia por chave/serviço)
    const syncStateCol = new Collection({
      name: 'sync_state',
      type: 'base',
      listRule: '@request.auth.id != ""',
      viewRule: '@request.auth.id != ""',
      createRule: '@request.auth.id != ""',
      updateRule: '@request.auth.id != ""',
      deleteRule: '@request.auth.id != ""',
      fields: [
        { name: 'key', type: 'text', required: true },
        { name: 'last_sync', type: 'date' },
        { name: 'last_status', type: 'text' },
        { name: 'last_error', type: 'text' },
        { name: 'details', type: 'json' },
        { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
      ],
      indexes: ['CREATE UNIQUE INDEX idx_sync_state_key ON sync_state (key)'],
    })
    app.save(syncStateCol)

    // Obter referências das coleções existentes para relations
    const accountsColId = app.findCollectionByNameOrId('accounts').id
    const crmContactsColId = app.findCollectionByNameOrId('crm_contacts').id
    const conversationsColId = app.findCollectionByNameOrId('conversations').id

    // 2. Coleção appointments
    // patient_name, patient_phone, patient_id (opcional, ref ao CRM), doctor, city, location,
    // starts_at, ends_at, status, appointment_type, source, external_id, conversation_id, notes,
    // sync_hash, last_synced_at, sync_error, account_id
    const appointmentsCol = new Collection({
      name: 'appointments',
      type: 'base',
      listRule: '@request.auth.id != ""',
      viewRule: '@request.auth.id != ""',
      createRule: '@request.auth.id != ""',
      updateRule: '@request.auth.id != ""',
      deleteRule: '@request.auth.id != ""',
      fields: [
        { name: 'account_id', type: 'relation', collectionId: accountsColId, maxSelect: 1 },
        { name: 'patient_name', type: 'text', required: true },
        { name: 'patient_phone', type: 'text' },
        { name: 'patient_id', type: 'relation', collectionId: crmContactsColId, maxSelect: 1 },
        {
          name: 'conversation_id',
          type: 'relation',
          collectionId: conversationsColId,
          maxSelect: 1,
        },
        { name: 'doctor', type: 'text' },
        {
          name: 'city',
          type: 'select',
          values: ['Carmo do Rio Claro', 'Alfenas', 'Monte Belo', 'Online'],
          maxSelect: 1,
        },
        { name: 'location', type: 'text' },
        { name: 'starts_at', type: 'date', required: true },
        { name: 'ends_at', type: 'date', required: true },
        {
          name: 'status',
          type: 'select',
          values: ['agendado', 'confirmado', 'realizado', 'faltou', 'remarcado', 'cancelado'],
          maxSelect: 1,
        },
        { name: 'appointment_type', type: 'text' },
        {
          name: 'source',
          type: 'select',
          values: ['agenda_externa', 'crm'],
          maxSelect: 1,
        },
        { name: 'external_id', type: 'text' },
        { name: 'notes', type: 'text' },
        { name: 'sync_hash', type: 'text' },
        { name: 'last_synced_at', type: 'date' },
        { name: 'sync_error', type: 'text' },
        { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
      ],
      indexes: [
        'CREATE UNIQUE INDEX idx_appointments_source_external ON appointments (source, external_id) WHERE external_id != "" AND external_id IS NOT NULL',
        'CREATE INDEX idx_appointments_starts_at ON appointments (starts_at)',
        'CREATE INDEX idx_appointments_patient_phone ON appointments (patient_phone)',
        'CREATE INDEX idx_appointments_city ON appointments (city)',
        'CREATE INDEX idx_appointments_status ON appointments (status)',
      ],
    })
    app.save(appointmentsCol)
  },
  (app) => {
    try {
      const appointments = app.findCollectionByNameOrId('appointments')
      app.delete(appointments)
    } catch (_) {}

    try {
      const syncState = app.findCollectionByNameOrId('sync_state')
      app.delete(syncState)
    } catch (_) {}
  },
)
