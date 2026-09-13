/// <reference path="../pb_data/types.d.ts" />
migrate(
  (app) => {
    // 1. Limpa contaminação cruzada no contato Caio Cândido e qualquer contato com alucinação residual
    try {
      app
        .db()
        .newQuery(
          "UPDATE crm_contacts SET ai_suggested_action = '' WHERE ai_suggested_action LIKE '%Elayne%' OR ai_suggested_action LIKE '%Elaine%' OR ai_suggested_action LIKE '%Edvan%'",
        )
        .execute()
    } catch (err1) {
      console.log(
        '[0093_clean_hallucinations] Erro ao limpar ai_suggested_action contaminadas:',
        err1,
      )
    }

    // 2. Reseta o ai_conversation_id da conversa do Caio para garantir isolamento limpo de sessão no agente
    try {
      app
        .db()
        .newQuery(
          "UPDATE conversations SET ai_conversation_id = '' WHERE remote_jid = '553599716747@s.whatsapp.net'",
        )
        .execute()
    } catch (err2) {
      console.log(
        '[0093_clean_hallucinations] Erro ao resetar ai_conversation_id de 553599716747@s.whatsapp.net:',
        err2,
      )
    }
  },
  (app) => {
    // Reversão não é necessária pois são apenas resets de dados alucinados
  },
)
