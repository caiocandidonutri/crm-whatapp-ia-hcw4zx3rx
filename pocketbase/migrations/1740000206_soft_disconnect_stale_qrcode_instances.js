// Idempotente e soft-only: instâncias mortas viram 'disconnected', nada é apagado.
// Zera regeneração de QR para TODA instância 'qrcode' cujo nome NÃO seja a
// instância conectada ativa (instance_1794858668780). O QR do WhatsApp expira
// em ~60s — QR antigo em status 'qrcode' é um QR morto que o health-check
// continuaria regenerando. Nenhum campo é apagado (qrcode_base64 preservado).
migrate(
  (app) => {
    app
      .db()
      .newQuery(
        "UPDATE whatsapp_instances SET status = 'disconnected' WHERE status = 'qrcode' AND instance_name != {:keep}",
      )
      .bind({
        keep: 'instance_1794858668780',
      })
      .execute()

    console.log(
      'migration 1740000206: instâncias qrcode antigas -> disconnected (soft, sem delete)',
    )
  },
  (app) => {
    // down: sem reversão de dados (soft-only); nada a fazer.
  },
)
