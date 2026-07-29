// Endpoint para editar manualmente o `contact_name` de uma conversa.
// Atualiza `conversations.contact_name` E `crm_contacts.contact_name`
// (se houver registro CRM) em sincronia, pra que o nome custom do
// usuário apareça consistente em toda a UI.
//
// Body: { instance_name: string, remote_jid: string, contact_name: string }
//
// Usado pelo botão "Editar nome" no menu kebab da ChatArea — útil pra
// convs onde o pushName chegou vazio (histórico via syncFullHistory)
// ou onde o nome ficou corrompido em estado anterior do código.
routerAdd(
  'POST',
  '/backend/v1/whatsapp/update-contact-name',
  (e) => {
    try {
      const body = e.requestInfo().body || {}
      const instanceName = body.instance_name
      const remoteJid = body.remote_jid
      const contactName = body.contact_name

      if (!instanceName || !remoteJid) {
        return e.json(400, {
          success: false,
          error: 'instance_name e remote_jid obrigatórios',
        })
      }

      const userId = e.auth?.id
      if (!userId) {
        return e.json(401, { success: false, error: 'unauthorized' })
      }

      // Sanitiza: trim + limita 100 chars. String vazia é válida (limpa o nome).
      const safeName = String(contactName == null ? '' : contactName)
        .trim()
        .substring(0, 100)

      let updatedConv = false
      let updatedCrm = false

      // Update da conversation (autoritativa — o webhook lê deste campo)
      try {
        const conv = $app.findFirstRecordByFilter(
          'conversations',
          'user_id = {:userId} && instance_name = {:instanceName} && remote_jid = {:jid}',
          { userId, instanceName, jid: remoteJid },
        )
        conv.set('contact_name', safeName)
        $app.save(conv)
        updatedConv = true
      } catch (_) {
        // Sem conv associada (raro) — não bloqueia o update do CRM.
      }

      // Update do crm_contact se existir (espelho)
      try {
        const crm = $app.findFirstRecordByFilter(
          'crm_contacts',
          'user_id = {:userId} && instance_name = {:instanceName} && jid = {:jid}',
          { userId, instanceName, jid: remoteJid },
        )
        crm.set('contact_name', safeName)
        $app.save(crm)
        updatedCrm = true
      } catch (_) {
        // Sem crm contact, OK — nem todo contato está no CRM.
      }

      if (!updatedConv && !updatedCrm) {
        return e.json(404, {
          success: false,
          error: 'nem conversation nem crm_contact encontrados',
        })
      }

      return e.json(200, {
        success: true,
        contact_name: safeName,
        updated_conversation: updatedConv,
        updated_crm: updatedCrm,
      })
    } catch (err) {
      $app.logger().error('update_contact_name_error', 'error', String(err))
      return e.json(500, { success: false, error: 'internal_error' })
    }
  },
  $apis.requireAuth(),
)
