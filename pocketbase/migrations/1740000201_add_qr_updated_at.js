/// <reference path="../pb_data/types.d.ts" />
/**
 * v0.0.250 — PASSO 1: campo qr_updated_at em whatsapp_instances.
 *
 * Idempotente: se o campo já existir, não faz nada. Soft-only: não apaga
 * nada, só adiciona a coluna de data que o endpoint de status usa para
 * expirar QRs velhos (>55s) e forçar /instance/connect novo.
 */
migrate(
  (app) => {
    const col = app.findCollectionByNameOrId('whatsapp_instances')
    const has = col.fields.getByName('qr_updated_at')
    if (!has) {
      col.fields.add(new Field({ name: 'qr_updated_at', type: 'date' }))
      app.save(col)
    }
  },
  (app) => {
    const col = app.findCollectionByNameOrId('whatsapp_instances')
    const has = col.fields.getByName('qr_updated_at')
    if (has) {
      col.fields.removeByName('qr_updated_at')
      app.save(col)
    }
  },
)
