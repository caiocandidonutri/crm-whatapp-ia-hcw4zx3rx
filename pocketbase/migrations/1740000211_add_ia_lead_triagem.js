// Triagem do Lead de Tráfego Pago — campo em crm_contacts (soft-only, idempotente).
// A IA Fabiana coleta na conversa: queixa principal, há quanto tempo,
// preferência presencial/online e período preferido. A triagem coletada é
// registrada em JSON no contato para a equipe priorizar no painel.
//   ia_lead_triagem_json  json — { queixa, tempo, modalidade, periodo, updated_at }
// Zero deletes: só adiciona o campo se ele ainda não existir.
migrate(
  (app) => {
    const col = app.findCollectionByNameOrId('crm_contacts')
    try {
      col.fields.getByName('ia_lead_triagem_json')
      console.log('migration 1740000211: ia_lead_triagem_json já existe — nada a fazer')
    } catch (_) {
      col.fields.add(new JSONField({ name: 'ia_lead_triagem_json', maxSize: 2000000 }))
      app.save(col)
      console.log('migration 1740000211: campo ia_lead_triagem_json criado em crm_contacts')
    }
  },
  (app) => {
    // down: soft-only — nada é apagado.
  },
)
