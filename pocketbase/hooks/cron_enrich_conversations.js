cronAdd('enrich_conversations', '* * * * *', () => {
  const urlStr = $secrets.get('EVOLUTION_API_URL') || ''
  const apiUrl = urlStr.endsWith('/') ? urlStr.slice(0, -1) : urlStr
  const apiKey = $secrets.get('EVOLUTION_API_KEY') || ''

  if (!apiUrl || !apiKey) {
    return
  }

  // Helper de formatação de telefone BR
  function formatBrPhone(raw) {
    if (!raw) return ''
    var digits = String(raw).replace(/\D/g, '')
    if (digits.startsWith('55') && (digits.length === 12 || digits.length === 13)) {
      digits = digits.slice(2)
    }
    if (digits.length === 11) {
      return '(' + digits.slice(0, 2) + ') ' + digits.slice(2, 7) + '-' + digits.slice(7)
    }
    if (digits.length === 10) {
      return '(' + digits.slice(0, 2) + ') ' + digits.slice(2, 6) + '-' + digits.slice(6)
    }
    return digits ? '+' + digits : ''
  }

  function isInvalidName(name) {
    if (!name) return true
    var trimmed = String(name).trim()
    if (!trimmed) return true
    if (trimmed.indexOf('@') !== -1) return true
    if (/^[.\-_*#@!?,:;~^`'"]+$/.test(trimmed)) return true
    if (/^\d{10,}$/.test(trimmed)) return true
    // Deve ter pelo menos uma letra (latina, com acento) ou caractere significativo, não só pontuação/números
    if (!/[a-zA-Z\u00C0-\u017F]/.test(trimmed)) {
      return true
    }
    var lower = trimmed.toLowerCase()
    if (
      [
        'você',
        'voce',
        'eu',
        'you',
        'me',
        'i',
        'contato whatsapp',
        'sem nome',
        'null',
        'undefined',
        'desconhecido',
      ].indexOf(lower) !== -1
    )
      return true
    return false
  }

  // Propagação do novo nome para mensagens, crm_contacts e tarefas
  function propagateName(conversationRecord, finalName) {
    if (!finalName || isInvalidName(finalName)) return
    const remoteJid = conversationRecord.getString('remote_jid')
    const instanceName = conversationRecord.getString('instance_name')
    const convId = conversationRecord.id

    // 1. Propagar para whatsapp_messages com push_name vazio
    try {
      $app
        .db()
        .newQuery(
          "UPDATE whatsapp_messages SET push_name = {:name} WHERE conversation = {:convId} AND (push_name = '' OR push_name IS NULL)",
        )
        .bind({ name: finalName, convId: convId })
        .execute()
    } catch (e) {
      $app.logger().warn('propagate_name_messages_err', 'error', String(e))
    }

    // 2. Propagar para crm_contacts
    let crmContactId = ''
    try {
      const contacts = $app.findRecordsByFilter(
        'crm_contacts',
        'instance_name = {:inst} && (jid = {:jid} || phone ~ {:phone})',
        '+created',
        1,
        0,
        {
          inst: instanceName,
          jid: remoteJid,
          phone: remoteJid.split('@')[0],
        },
      )
      if (contacts && contacts.length > 0) {
        const contact = contacts[0]
        crmContactId = contact.id
        if (isInvalidName(contact.getString('contact_name'))) {
          contact.set('contact_name', finalName)
          $app.save(contact)
        }
      }
    } catch (e) {
      $app.logger().warn('propagate_name_crm_err', 'error', String(e))
    }

    // 3. Propagar para tarefas vinculadas à conversa ou contato
    try {
      let filter = 'conversation_id = {:convId}'
      const params = { convId: convId }
      if (crmContactId) {
        filter += ' || crm_contact_id = {:crmId}'
        params.crmId = crmContactId
      }
      const tasks = $app.findRecordsByFilter('tasks', filter, '+created', 10, 0, params)
      for (const t of tasks) {
        let taskTitle = t.getString('title')
        if (
          isInvalidName(taskTitle) ||
          taskTitle.startsWith('Falar com') ||
          taskTitle.startsWith('Atender')
        ) {
          t.set('title', 'Atendimento: ' + finalName)
          $app.save(t)
        }
      }
    } catch (e) {
      $app.logger().warn('propagate_name_tasks_err', 'error', String(e))
    }
  }

  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().replace('T', ' ')

  // Prioriza conversas que estão sem contact_name ou com contact_name inválido ("." etc)
  const filter =
    "(contact_name = '' || contact_name = '.' || avatar_url = '') && (picture_fetched_at = '' || picture_fetched_at < {:yesterday})"

  let records = []
  try {
    records = $app.findRecordsByFilter('conversations', filter, '+created', 30, 0, { yesterday })
  } catch (err) {
    $app.logger().error('cron_enrich_conversations fetch error', 'error', String(err))
    return
  }

  if (!records || records.length === 0) return

  const instancesToFetchContacts = new Set()
  for (const r of records) {
    if (!r.getBool('is_group') && !r.getString('contact_name')) {
      instancesToFetchContacts.add(r.getString('instance_name'))
    }
  }

  const contactsMap = {} // { instanceName: { remoteJid: name } }
  for (const instanceName of instancesToFetchContacts) {
    contactsMap[instanceName] = {}
    try {
      const res = $http.send({
        url: apiUrl + '/chat/findContacts/' + instanceName,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: apiKey },
        body: JSON.stringify({}),
        timeout: 15,
      })

      const contactsList = Array.isArray(res.json) ? res.json : []
      for (const c of contactsList) {
        const jid = c.id || c.remoteJid || c.jid || ''
        if (!jid) continue
        const name = c.verifiedName || c.pushName || c.name || ''
        if (name && !isInvalidName(name)) {
          contactsMap[instanceName][jid] = name
          const jidBase = jid.split('@')[0]
          contactsMap[instanceName][jidBase] = name
        }
      }
    } catch (err) {
      $app
        .logger()
        .warn('enrich_find_contacts_exception', 'instance', instanceName, 'error', String(err))
    }
  }

  let processedCount = 0
  let successCount = 0

  for (const record of records) {
    processedCount++
    const instanceName = record.getString('instance_name')
    // Não enriquece conversas de instâncias inativas/desconectadas
    if (!instanceName) continue
    try {
      const instRecord = $app.findFirstRecordByFilter(
        'whatsapp_instances',
        'instance_name = {:name}',
        { name: instanceName },
      )
      if (!instRecord || instRecord.getString('status') !== 'connected') {
        continue
      }
    } catch (_) {
      // Instância inexistente ou erro = desconectada, pular
      continue
    }

    const remoteJid = record.getString('remote_jid')
    const isGroup = record.getBool('is_group')
    let updated = false
    let discoveredName = ''

    const debug = {
      timestamp: new Date().toISOString(),
      isGroup: isGroup,
      remoteJid: remoteJid,
    }

    try {
      let picUrl = ''
      let subject = ''
      let groupSize = 0

      if (isGroup) {
        const fetchUrl =
          apiUrl +
          '/group/findGroupInfos/' +
          instanceName +
          '?groupJid=' +
          encodeURIComponent(remoteJid)

        try {
          const res = $http.send({
            url: fetchUrl,
            method: 'GET',
            headers: { apikey: apiKey },
            timeout: 10,
          })

          if (res.statusCode === 200 && res.json) {
            picUrl = res.json.pictureUrl || res.json.profilePictureUrl || ''
            subject = res.json.subject || ''
            groupSize = res.json.size || (res.json.participants ? res.json.participants.length : 0)
          }
        } catch (httpErr) {
          debug.findGroupInfos_error = String(httpErr)
        }

        if (!subject || !groupSize) {
          try {
            const fallbackUrl =
              apiUrl +
              '/group/findGroupByJid/' +
              instanceName +
              '?groupJid=' +
              encodeURIComponent(remoteJid)

            const res2 = $http.send({
              url: fallbackUrl,
              method: 'GET',
              headers: { apikey: apiKey },
              timeout: 10,
            })

            if (res2.statusCode === 200 && res2.json && res2.json.length > 0) {
              const g = res2.json[0]
              if (!subject) subject = g.subject || ''
              if (!groupSize) groupSize = g.size || (g.participants ? g.participants.length : 0)
              if (!picUrl) picUrl = g.pictureUrl || g.profilePictureUrl || ''
            }
          } catch (err) {
            debug.findGroupByJid_error = String(err)
          }
        }

        if (subject && isInvalidName(record.getString('contact_name'))) {
          record.set('contact_name', subject)
          discoveredName = subject
          updated = true
        }
        if (groupSize > 0) {
          record.set('group_size', groupSize)
          updated = true
        }
      } else {
        // Individual chat: tentar contactsMap
        if (isInvalidName(record.getString('contact_name'))) {
          const map = contactsMap[instanceName]
          if (map) {
            const jidBase = remoteJid.split('@')[0]
            const foundName = map[remoteJid] || map[jidBase]
            if (foundName && !isInvalidName(foundName)) {
              discoveredName = foundName
              record.set('contact_name', foundName)
              debug.contact_name_from_findContacts = true
              updated = true
            }
          }
        }

        // Se ainda não achou nome, tentar endpoint fetchProfile da Evolution
        if (!discoveredName && isInvalidName(record.getString('contact_name'))) {
          try {
            const cleanNum = remoteJid.split('@')[0]
            const profRes = $http.send({
              url: apiUrl + '/chat/fetchProfile/' + instanceName,
              method: 'POST',
              headers: { 'Content-Type': 'application/json', apikey: apiKey },
              body: JSON.stringify({ number: cleanNum }),
              timeout: 10,
            })
            if (profRes.statusCode === 200 && profRes.json) {
              const p = profRes.json
              const candName = p.name || p.pushName || p.verifiedName || ''
              if (candName && !isInvalidName(candName)) {
                discoveredName = candName
                record.set('contact_name', candName)
                debug.contact_name_from_fetchProfile = true
                updated = true
              }
              if (!picUrl && (p.picture || p.profilePictureUrl)) {
                picUrl = p.picture || p.profilePictureUrl
              }
            }
          } catch (profErr) {
            debug.fetchProfile_error = String(profErr)
          }
        }

        // Foto de perfil
        try {
          const res = $http.send({
            url: apiUrl + '/chat/fetchProfilePictureUrl/' + instanceName,
            method: 'POST',
            headers: { 'Content-Type': 'application/json', apikey: apiKey },
            body: JSON.stringify({ number: remoteJid }),
            timeout: 10,
          })

          if (res.statusCode === 200 && res.json && res.json.profilePictureUrl) {
            picUrl = res.json.profilePictureUrl
          }
        } catch (err) {
          debug.fetchProfilePictureUrl_error = String(err)
        }
      }

      // Se ainda não tiver nome nenhum após todas as consultas da Evolution, aplicar fallback formatado BR
      if (isInvalidName(record.getString('contact_name'))) {
        const fb = isGroup ? 'Grupo WhatsApp' : formatBrPhone(remoteJid)
        if (fb) {
          record.set('contact_name', fb)
          discoveredName = fb
          updated = true
        }
      }

      if (picUrl) {
        record.set('avatar_url', picUrl)
        try {
          const f = $filesystem.fileFromURL(picUrl, 10)
          record.set('avatar', f)
          debug.fileFromURL = { picUrl: picUrl, ok: true }
        } catch (e) {
          debug.fileFromURL_error = String(e)
        }
        updated = true
      }

      record.set('enrich_debug', JSON.stringify(debug))
      record.set('picture_fetched_at', new Date().toISOString().replace('T', ' '))
      $app.save(record)

      // Propagar para mensagens, CRM e tarefas
      if (discoveredName) {
        propagateName(record, discoveredName)
      }

      if (updated) successCount++
    } catch (err) {
      debug.process_error = String(err)
      try {
        record.set('enrich_debug', JSON.stringify(debug))
        record.set('picture_fetched_at', new Date().toISOString().replace('T', ' '))
        $app.save(record)
      } catch (_) {}
    }
  }

  $app.logger().info('enrich_run_done', 'processed', processedCount, 'success', successCount)
})
