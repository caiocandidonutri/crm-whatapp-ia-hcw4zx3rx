// Painel "Leads IA ativos": lista e toggle liga/desliga por contato.
// Rotas autenticadas (X-CRM-Token não é necessário — usa o auth do usuário):
//   GET  /backend/v1/ia-lead/leads
//   POST /backend/v1/ia-lead/toggle  { contact_id, active }
// Nada é apagado: toggle OFF apenas sai do loop (stage 'off'), sem delete.

routerAdd('GET', '/backend/v1/ia-lead/leads', (e) => {
  var userId = e.auth && e.auth.id
  if (!userId) return e.unauthorizedError('auth required')

  var accountId = ''
  try {
    var member = $app.findFirstRecordByFilter('account_members', 'user_id = {:uid}', {
      uid: userId,
    })
    accountId = member.getString('account_id')
  } catch (_) {}

  var leads = []
  try {
    var filter = accountId ? 'ia_lead_loop = true && account_id = {:acc}' : 'ia_lead_loop = true'
    var params = accountId ? { acc: accountId } : {}
    var recs = $app.findRecordsByFilter('crm_contacts', filter, '-updated', 200, 0, params)
    var nowTs = Math.floor(Date.now() / 1000)
    for (var i = 0; i < recs.length; i++) {
      var c = recs[i]
      var lastMsgTs = c.getInt('ia_lead_last_message_ts') || 0
      leads.push({
        id: c.id,
        contact_name: c.getString('contact_name') || c.getString('push_name') || '',
        jid: c.getString('jid') || '',
        phone: (c.getString('jid') || '').split('@')[0],
        stage: c.getString('ia_lead_stage') || '',
        source: c.getString('ia_lead_source') || 'trafego_pago',
        pending_reply: c.getBool('ia_lead_pending_reply'),
        followup_count: c.getInt('ia_lead_followup_count') || 0,
        retry_count: c.getInt('ia_lead_retry_count') || 0,
        last_trigger_at: c.getString('ia_lead_last_trigger_at') || '',
        last_ai_reply_at: c.getString('ia_lead_last_ai_reply_at') || '',
        last_followup_at: c.getString('ia_lead_last_followup_at') || '',
        disabled_at: c.getString('ia_lead_disabled_at') || '',
        disabled_by: c.getString('ia_lead_disabled_by') || '',
        minutes_since_trigger: lastMsgTs ? Math.floor((nowTs - lastMsgTs) / 60) : null,
        care_state: c.getString('care_state') || '',
      })
    }
  } catch (err) {
    return e.json(200, { success: false, leads: [], error: String(err) })
  }

  return e.json(200, { success: true, leads: leads })
})

routerAdd('POST', '/backend/v1/ia-lead/toggle', (e) => {
  var userId = e.auth && e.auth.id
  if (!userId) return e.unauthorizedError('auth required')

  var body = {}
  try {
    body = e.readBodyJson()
  } catch (_) {}

  var contactId = body.contact_id || ''
  var active = !!body.active
  if (!contactId) return e.json(400, { success: false, error: 'contact_id obrigatório' })

  var c = null
  try {
    c = $app.findRecordById('crm_contacts', contactId)
  } catch (_) {
    return e.json(404, { success: false, error: 'contato não encontrado' })
  }

  c.set('ia_lead_loop', active)
  if (active) {
    c.set('ia_lead_stage', 'lead')
    c.set('ia_lead_disabled_at', '')
    c.set('ia_lead_disabled_by', '')
    c.set('ia_lead_retry_count', 0)
    c.set('ia_lead_followup_count', 0)
  } else {
    c.set('ia_lead_stage', 'off')
    c.set('ia_lead_pending_reply', false)
    c.set('ia_lead_disabled_at', new Date().toISOString())
    c.set('ia_lead_disabled_by', 'painel')
  }
  $app.save(c)

  return e.json(200, {
    success: true,
    id: c.id,
    ia_lead_loop: c.getBool('ia_lead_loop'),
    stage: c.getString('ia_lead_stage'),
  })
})
