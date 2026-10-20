/// <reference path="../pb_data/types.d.ts" />

migrate(
  (app) => {
    // Migração idempotente:
    // Consulta futura com status 'a_confirmar' -> 'agendado'
    // 'a_confirmar' é exclusivo para consulta PASSADA sem status final.
    try {
      const nowIso = new Date().toISOString()
      const query = app
        .db()
        .newQuery(
          "UPDATE appointments SET status = 'agendado', updated = {:now} WHERE status = 'a_confirmar' AND starts_at >= {:nowIso}",
        )
        .bind({
          now: new Date().toISOString().replace('T', ' ').substring(0, 19),
          nowIso: nowIso,
        })
      query.execute()
    } catch (e) {
      // Ignora caso appointments não possua registros correspondentes
    }
  },
  (app) => {},
)
