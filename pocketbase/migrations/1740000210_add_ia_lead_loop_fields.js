// Loop do Lead de Tráfego Pago — campos em crm_contacts (soft-only, idempotente).
// Nada é apagado: apenas adiciona campos de controle do loop de IA.
//   ia_lead_loop             bool    — contato está no loop de IA
//   ia_lead_stage            select  — lead|human_pending|engaged|converted|off
//   ia_lead_source           text    — origem do lead (ex: trafego_pago)
//   ia_lead_last_trigger_at  date    — última msg que casou com gatilho
//   ia_lead_last_message_ts  number  — timestamp (unix) da última msg do lead
//   ia_lead_pending_reply    bool    — IA deve responder (~2min após gatilho)
//   ia_lead_retry_count      number  — tentativas de resposta da IA
//   ia_lead_followup_count   number  — follow-ups enviados no ciclo atual
//   ia_lead_last_ai_reply_at date    — última resposta da IA
//   ia_lead_last_followup_at date    — último follow-up enviado
//   ia_lead_disabled_at      date    — quando a IA foi desligada
//   ia_lead_disabled_by      text    — quem desligou (humano_celular|humano_crm|painel|humano_followup)
migrate(
  (app) => {
    const col = app.findCollectionByNameOrId('crm_contacts')

    function ensureBool(name) {
      try {
        col.fields.getByName(name)
      } catch (_) {
        col.fields.add(new BoolField({ name: name }))
      }
    }
    function ensureNumber(name) {
      try {
        col.fields.getByName(name)
      } catch (_) {
        col.fields.add(new NumberField({ name: name, onlyInt: true }))
      }
    }
    function ensureText(name) {
      try {
        col.fields.getByName(name)
      } catch (_) {
        col.fields.add(new TextField({ name: name, max: 100 }))
      }
    }
    function ensureDate(name) {
      try {
        col.fields.getByName(name)
      } catch (_) {
        col.fields.add(new DateField({ name: name }))
      }
    }

    ensureBool('ia_lead_loop')
    ensureText('ia_lead_source')
    ensureNumber('ia_lead_last_message_ts')
    ensureBool('ia_lead_pending_reply')
    ensureNumber('ia_lead_retry_count')
    ensureNumber('ia_lead_followup_count')
    ensureDate('ia_lead_last_trigger_at')
    ensureDate('ia_lead_last_ai_reply_at')
    ensureDate('ia_lead_last_followup_at')
    ensureDate('ia_lead_disabled_at')
    ensureText('ia_lead_disabled_by')

    try {
      col.fields.getByName('ia_lead_stage')
    } catch (_) {
      col.fields.add(
        new SelectField({
          name: 'ia_lead_stage',
          maxSelect: 1,
          values: ['lead', 'human_pending', 'engaged', 'converted', 'off'],
        }),
      )
    }

    app.save(col)
    console.log('migration 1740000210: campos ia_lead_* em crm_contacts garantidos')
  },
  (app) => {
    // down: soft-only — nada é apagado.
  },
)
