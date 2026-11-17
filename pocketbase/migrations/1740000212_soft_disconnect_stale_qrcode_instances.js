// Idempotente e soft-only (mesmo padrão de 1740000206): instâncias órfãs em
// status 'qrcode' cujo QR já está morto (qr_updated_at vazio ou com mais de
// 1h) viram 'disconnected'. O QR do WhatsApp expira em ~60s — QR antigo em
// status 'qrcode' é um QR morto que o fluxo de conexão continuaria
// regenerando em loop (caso das órfãs criadas às 00h53 e 01h05 de 17/11,
// last_webhook_reconfigured_at vazio). Nada é apagado: qrcode_base64 e todos
// os campos são preservados. A instância REAL connected não é tocada (só
// instâncias em status 'qrcode' são afetadas).
migrate(
  (app) => {
    app
      .db()
      .newQuery(
        "UPDATE whatsapp_instances SET status = 'disconnected' WHERE status = 'qrcode' AND (qr_updated_at = '' OR qr_updated_at IS NULL OR qr_updated_at < datetime('now', '-1 hour'))",
      )
      .bind({
        now: new Date().toISOString().replace('T', ' '),
      })
      .execute()

    console.log(
      'migration 1740000212: instâncias qrcode com QR expirado (>1h) -> disconnected (soft, sem delete)',
    )
  },
  (app) => {
    // down: sem reversão de dados (soft-only); nada a fazer.
  },
)
