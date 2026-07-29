// Apaga TODOS os dados da conta logada e o usuário em si.
//
// Ordem (importante para evitar lixo orfão):
// 1. Logout + delete da instância na Evolution API (best-effort).
// 2. Apaga whatsapp_messages do user.
// 3. Apaga conversations do user.
// 4. Apaga crm_contacts do user.
// 5. Apaga whatsapp_instances do user.
// 6. Apaga o registro do user em `users` (auto-logout no front).
//
// Cada etapa é envolvida em try/catch — uma falhar não impede as próximas.
routerAdd(
  'POST',
  '/backend/v1/whatsapp/factory-reset',
  (e) => {
    try {
      const authId = e.auth.id
      if (!authId) {
        return e.json(401, { success: false, error: 'unauthorized' })
      }

      const urlStr = $secrets.get('EVOLUTION_API_URL') || ''
      const apiUrl = urlStr.endsWith('/') ? urlStr.slice(0, -1) : urlStr
      const apiKey = $secrets.get('EVOLUTION_API_KEY') || ''
      const headers = { apikey: apiKey }

      // 1. Para cada instância do user, logout + delete na Evolution
      let instances = []
      try {
        instances = $app.findRecordsByFilter(
          'whatsapp_instances',
          'user_id = {:userId}',
          '+created',
          100,
          0,
          { userId: authId },
        )
      } catch (_) {}

      for (const inst of instances) {
        const name = inst.getString('instance_name')
        if (!name || !apiUrl || !apiKey) continue

        try {
          $http.send({
            url: apiUrl + '/instance/logout/' + name,
            method: 'DELETE',
            headers: headers,
            timeout: 10,
          })
        } catch (_) {}

        try {
          $http.send({
            url: apiUrl + '/instance/delete/' + name,
            method: 'DELETE',
            headers: headers,
            timeout: 10,
          })
        } catch (_) {}
      }

      const deletedCounts = {
        messages: 0,
        conversations: 0,
        crm_contacts: 0,
        instances: 0,
      }

      // Helper para apagar todos os records de uma collection com paginação
      const purgeCollection = (name, counterKey) => {
        let safety = 100 // máximo 100 batches (= 100*200 = 20k registros)
        while (safety-- > 0) {
          let records = []
          try {
            records = $app.findRecordsByFilter(name, 'user_id = {:userId}', '+created', 200, 0, {
              userId: authId,
            })
          } catch (queryErr) {
            $app.logger().warn('factory_reset_query_error', 'col', name, 'error', String(queryErr))
            return
          }

          if (!records || records.length === 0) return

          for (const r of records) {
            try {
              $app.delete(r)
              deletedCounts[counterKey]++
            } catch (delErr) {
              $app.logger().warn('factory_reset_delete_error', 'col', name, 'error', String(delErr))
            }
          }
        }
      }

      purgeCollection('whatsapp_messages', 'messages')
      purgeCollection('conversations', 'conversations')
      purgeCollection('crm_contacts', 'crm_contacts')
      purgeCollection('whatsapp_instances', 'instances')

      // 6. Apaga o user. O front detecta a invalidação do auth e redireciona.
      try {
        const userRecord = $app.findRecordById('users', authId)
        $app.delete(userRecord)
      } catch (userErr) {
        $app.logger().warn('factory_reset_delete_user_error', 'error', String(userErr))
      }

      $app
        .logger()
        .info(
          'factory_reset_done',
          'userId',
          authId,
          'messages',
          deletedCounts.messages,
          'conversations',
          deletedCounts.conversations,
          'crm_contacts',
          deletedCounts.crm_contacts,
          'instances',
          deletedCounts.instances,
        )

      return e.json(200, { success: true, deleted: deletedCounts })
    } catch (err) {
      $app.logger().error('factory_reset_fatal', 'error', String(err))
      return e.json(500, { success: false, error: 'internal_error' })
    }
  },
  $apis.requireAuth(),
)
