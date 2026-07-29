cronAdd('enrich_conversations', '* * * * *', () => {
  const urlStr = $secrets.get('EVOLUTION_API_URL') || ''
  const apiUrl = urlStr.endsWith('/') ? urlStr.slice(0, -1) : urlStr
  const apiKey = $secrets.get('EVOLUTION_API_KEY') || ''

  if (!apiUrl || !apiKey) {
    return
  }

  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().replace('T', ' ')

  const filter =
    "(contact_name = '' || avatar_url = '') && (picture_fetched_at = '' || picture_fetched_at < {:yesterday})"

  let records = []
  try {
    records = $app.findRecordsByFilter('conversations', filter, '+created', 5, 0, { yesterday })
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
        if (name) {
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
    const remoteJid = record.getString('remote_jid')
    const isGroup = record.getBool('is_group')
    let updated = false

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
          $app
            .logger()
            .info(
              'enrich_group_info_start',
              'instance',
              instanceName,
              'remoteJid',
              remoteJid,
              'url',
              fetchUrl,
            )
          const res = $http.send({
            url: fetchUrl,
            method: 'GET',
            headers: { apikey: apiKey },
            timeout: 10,
          })

          const bodyPreview = res.json ? JSON.stringify(res.json).substring(0, 500) : ''

          debug.findGroupInfos = {
            url: fetchUrl,
            statusCode: res.statusCode,
            jsonKeys: res.json ? Object.keys(res.json) : [],
            subject: res.json && res.json.subject ? res.json.subject : '',
            profilePictureUrl: res.json
              ? res.json.pictureUrl || res.json.profilePictureUrl || ''
              : '',
            size: res.json
              ? res.json.size || (res.json.participants ? res.json.participants.length : 0)
              : 0,
            bodyPreview: bodyPreview,
          }

          $app
            .logger()
            .info(
              'enrich_group_info_response',
              'remoteJid',
              remoteJid,
              'statusCode',
              res.statusCode,
              'hasJson',
              !!res.json,
              'jsonKeys',
              res.json ? Object.keys(res.json).join(',') : '',
              'subject',
              res.json && res.json.subject ? res.json.subject : '',
              'profilePictureUrl',
              res.json ? res.json.pictureUrl || res.json.profilePictureUrl || '' : '',
              'size',
              res.json
                ? res.json.size || (res.json.participants ? res.json.participants.length : 0)
                : 0,
              'bodyPreview',
              bodyPreview,
            )

          if (res.statusCode === 200 && res.json) {
            picUrl = res.json.pictureUrl || res.json.profilePictureUrl || ''
            subject = res.json.subject || ''
            groupSize = res.json.size || (res.json.participants ? res.json.participants.length : 0)
          }
        } catch (httpErr) {
          debug.findGroupInfos_error = String(httpErr)
          $app
            .logger()
            .warn('enrich_group_info_exception', 'remoteJid', remoteJid, 'error', String(httpErr))
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

            debug.findGroupByJid = {
              url: fallbackUrl,
              statusCode: res2.statusCode,
              jsonLength: res2.json && Array.isArray(res2.json) ? res2.json.length : 0,
              firstSubject:
                res2.json && Array.isArray(res2.json) && res2.json.length > 0
                  ? res2.json[0].subject
                  : '',
              bodyPreview: res2.json ? JSON.stringify(res2.json).substring(0, 500) : '',
            }

            if (res2.statusCode === 200 && res2.json && res2.json.length > 0) {
              const g = res2.json[0]
              if (!subject) subject = g.subject || ''
              if (!groupSize) groupSize = g.size || (g.participants ? g.participants.length : 0)
              if (!picUrl) picUrl = g.pictureUrl || g.profilePictureUrl || ''
            }
          } catch (err) {
            debug.findGroupByJid_error = String(err)
            $app
              .logger()
              .warn('enrich_group_fallback_exception', 'remoteJid', remoteJid, 'error', String(err))
          }
        }

        if (subject && !record.getString('contact_name')) {
          record.set('contact_name', subject)
          updated = true
        }
        if (groupSize > 0) {
          record.set('group_size', groupSize)
          updated = true
        }
      } else {
        if (!record.getString('contact_name')) {
          const map = contactsMap[instanceName]
          if (map) {
            const jidBase = remoteJid.split('@')[0]
            const foundName = map[remoteJid] || map[jidBase]
            if (foundName) {
              record.set('contact_name', foundName)
              debug.contact_name_from_findContacts = true
              updated = true
            }
          }
        }

        try {
          $app.logger().info('enrich_profile_pic_start', 'remoteJid', remoteJid)
          const res = $http.send({
            url: apiUrl + '/chat/fetchProfilePictureUrl/' + instanceName,
            method: 'POST',
            headers: { 'Content-Type': 'application/json', apikey: apiKey },
            body: JSON.stringify({ number: remoteJid }),
            timeout: 10,
          })

          debug.fetchProfilePictureUrl = {
            statusCode: res.statusCode,
            profilePictureUrl:
              res.json && res.json.profilePictureUrl ? res.json.profilePictureUrl : '',
            bodyPreview: res.json ? JSON.stringify(res.json).substring(0, 500) : '',
          }

          $app
            .logger()
            .info(
              'enrich_profile_pic_response',
              'remoteJid',
              remoteJid,
              'statusCode',
              res.statusCode,
              'hasJson',
              !!res.json,
              'profilePictureUrl',
              res.json && res.json.profilePictureUrl ? res.json.profilePictureUrl : '',
            )

          if (res.statusCode === 200 && res.json && res.json.profilePictureUrl) {
            picUrl = res.json.profilePictureUrl
          }
        } catch (err) {
          debug.fetchProfilePictureUrl_error = String(err)
          $app
            .logger()
            .warn('enrich_profile_pic_exception', 'remoteJid', remoteJid, 'error', String(err))
        }
      }

      if (picUrl) {
        record.set('avatar_url', picUrl)
        try {
          $app
            .logger()
            .info('enrich_avatar_download_start', 'remoteJid', remoteJid, 'picUrl', picUrl)
          const f = $filesystem.fileFromURL(picUrl, 10)
          record.set('avatar', f)
          debug.fileFromURL = { picUrl: picUrl, ok: true }
        } catch (e) {
          debug.fileFromURL_error = String(e)
          $app
            .logger()
            .warn('enrich_avatar_download_exception', 'remoteJid', remoteJid, 'error', String(e))
        }
        updated = true
      }

      record.set('enrich_debug', JSON.stringify(debug))
      record.set('picture_fetched_at', new Date().toISOString().replace('T', ' '))
      $app.save(record)

      if (updated) successCount++
    } catch (err) {
      debug.process_error = String(err)
      $app
        .logger()
        .error(
          'cron_enrich_conversations process error',
          'remote_jid',
          remoteJid,
          'error',
          String(err),
        )
      try {
        record.set('enrich_debug', JSON.stringify(debug))
        record.set('picture_fetched_at', new Date().toISOString().replace('T', ' '))
        $app.save(record)
      } catch (_) {}
    }
  }

  $app.logger().info('enrich_run_done', 'processed', processedCount, 'success', successCount)
})
