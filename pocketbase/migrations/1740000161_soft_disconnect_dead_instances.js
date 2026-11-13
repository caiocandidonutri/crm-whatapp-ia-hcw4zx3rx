// Idempotente e soft-only: instâncias mortas viram 'disconnected', nada é apagado.
// Instâncias com status 'qrcode' criadas antes de hoje (2026-11-14) nunca
// conectaram — o QR delas já expirou há muito tempo (expira em ~60s).
migrate(
  (app) => {
    app
      .db()
      .newQuery(
        "UPDATE whatsapp_instances SET status = 'disconnected', updated = {:now} WHERE status = 'qrcode' AND created < {:cutoff}",
      )
      .bind({
        now: new Date(),
        cutoff: new Date('2026-11-14T00:00:00Z'),
      })
      .execute()

    console.log('migration 1740000161: whatsapp_instances mortas -> disconnected')
  },
  (app) => {
    // down: não há reversão de dados (soft-only); nada a fazer.
  },
)
