cronAdd('health_check', '*/5 * * * *', () => {
  const STALE_THRESHOLD_SEC = 10 * 60
  const WEBHOOK_RECONFIG_WINDOW_SEC = 5 * 60
  const RESTART_COOLDOWN_SEC = 15 * 60

  let instances = []
  try {
    instances = $app.findRecordsByFilter(
      'whatsapp_instances',
      "status = 'connected' && is_importing_history != true && needs_resync != true",
      '-created',
      100,
      0,
    )
  } catch (err) {
    $app.logger().error('cron_health_check_query_error', 'error', String(err))
    return
  }

  if (!instances || instances.length === 0) return

  const apiUrlRaw = $secrets.get('EVOLUTION_API_URL') || ''
  const apiUrl = apiUrlRaw.endsWith('/') ? apiUrlRaw.slice(0, -1) : apiUrlRaw
  const apiKey = $secrets.get('EVOLUTION_API_KEY') || ''

  if (!apiUrl || !apiKey) {
    $app.logger().warn('cron_health_check_missing_config')
    return
  }

  const headers = { 'Content-Type': 'application/json', apikey: apiKey }
  const nowSecs = Math.floor(Date.now() / 1000)
  const nowDateStr = new Date().toISOString().replace('T', ' ')

  const webhookEvents = [
    'APPLICATION_STARTUP',
    'QRCODE_UPDATED',
    'MESSAGES_SET',
    'MESSAGES_UPSERT',
    'MESSAGES_UPDATE',
    'MESSAGES_DELETE',
    'SEND_MESSAGE',
    'CONTACTS_SET',
    'CONTACTS_UPSERT',
    'CONTACTS_UPDATE',
    'PRESENCE_UPDATE',
    'CHATS_SET',
    'CHATS_UPSERT',
    'CHATS_UPDATE',
    'CHATS_DELETE',
    'GROUPS_UPSERT',
    'GROUP_UPDATE',
    'GROUP_PARTICIPANTS_UPDATE',
    'CONNECTION_UPDATE',
    'CALL',
  ]

  for (const instance of instances) {
    try {
      const instanceName = instance.getString('instance_name')

      let realConnected = false
      try {
        const resConn = $http.send({
          url: apiUrl + '/instance/connectionState/' + instanceName,
          method: 'GET',
          headers: headers,
          timeout: 10,
        })
        if (
          resConn.statusCode === 200 &&
          resConn.json &&
          resConn.json.instance &&
          resConn.json.instance.state === 'open'
        ) {
          realConnected = true
        }
      } catch (err) {
        $app
          .logger()
          .warn('health_check_conn_error', 'instance', instanceName, 'error', String(err))
      }

      if (!realConnected) {
        instance.set('status', 'disconnected')
        instance.set('last_health_check_at', nowDateStr)
        instance.set('health_check_failures', (instance.getInt('health_check_failures') || 0) + 1)
        $app.save(instance)
        $app.logger().info('health_check_real_disconnect', 'instance', instanceName)

        // Registrar notificação no sistema apenas na transição conectado -> desconectado
        // Notificar tanto o dono quanto os membros da conta (se houver account_id)
        try {
          const userId = instance.getString('user_id')
          const accountId = instance.getString('account_id')
          const notifCol = $app.findCollectionByNameOrId('notifications')

          let targetUserIds = []
          if (accountId) {
            try {
              const members = $app.findRecordsByFilter(
                'account_members',
                'account_id = {:accId}',
                '-created',
                100,
                0,
                { accId: accountId },
              )
              for (const m of members) {
                const uid = m.getString('user_id')
                if (uid && targetUserIds.indexOf(uid) === -1) {
                  targetUserIds.push(uid)
                }
              }
            } catch (_) {}
          }
          if (userId && targetUserIds.indexOf(userId) === -1) {
            targetUserIds.push(userId)
          }

          for (const uid of targetUserIds) {
            try {
              // Evitar notificações duplicadas não lidas para a mesma queda
              const existingNotifs = $app.findRecordsByFilter(
                'notifications',
                "user_id = {:uid} && type = 'system' && read = false && title ~ 'desconectada'",
                '-created',
                1,
                0,
                { uid: uid },
              )
              if (!existingNotifs || existingNotifs.length === 0) {
                const notif = new Record(notifCol)
                notif.set('user_id', uid)
                if (accountId) notif.set('account_id', accountId)
                notif.set('title', 'Instância WhatsApp desconectada')
                notif.set(
                  'body',
                  'A instância "' +
                    instanceName +
                    '" perdeu a conexão com o WhatsApp. Reconecte para continuar enviando e recebendo mensagens.',
                )
                notif.set('type', 'system')
                notif.set('read', false)
                $app.saveNoValidate(notif)
              }
            } catch (_) {}
          }
        } catch (_) {}

        continue
      }

      let lastMsgTs = 0
      try {
        const lastMsgs = $app.findRecordsByFilter(
          'whatsapp_messages',
          'instance_name = {:name}',
          '-timestamp',
          1,
          0,
          { name: instanceName },
        )
        if (lastMsgs && lastMsgs.length > 0) {
          lastMsgTs = lastMsgs[0].getInt('timestamp') || 0
        }
      } catch (_) {}

      const secsSinceLastMsg = lastMsgTs > 0 ? nowSecs - lastMsgTs : -1
      const isStale = lastMsgTs === 0 || secsSinceLastMsg > STALE_THRESHOLD_SEC

      instance.set('last_health_check_at', nowDateStr)

      if (!isStale) {
        if ((instance.getInt('health_check_failures') || 0) > 0) {
          instance.set('health_check_failures', 0)
        }
        $app.save(instance)
        continue
      }

      $app
        .logger()
        .info('health_check_stale', 'instance', instanceName, 'secsSinceLastMsg', secsSinceLastMsg)

      const lastWhReconfigStr = instance.getString('last_webhook_reconfigured_at') || ''
      const lastRestartStr = instance.getString('last_instance_restart_at') || ''

      let whReconfigSecs = 0
      if (lastWhReconfigStr) {
        try {
          whReconfigSecs = Math.floor(
            new Date(lastWhReconfigStr.replace(' ', 'T')).getTime() / 1000,
          )
          if (isNaN(whReconfigSecs)) whReconfigSecs = 0
        } catch (_) {
          whReconfigSecs = 0
        }
      }

      let restartSecs = 0
      if (lastRestartStr) {
        try {
          restartSecs = Math.floor(new Date(lastRestartStr.replace(' ', 'T')).getTime() / 1000)
          if (isNaN(restartSecs)) restartSecs = 0
        } catch (_) {
          restartSecs = 0
        }
      }

      const sinceWhReconfig = whReconfigSecs > 0 ? nowSecs - whReconfigSecs : 999999999
      const sinceRestart = restartSecs > 0 ? nowSecs - restartSecs : 999999999

      let didRecovery = false

      if (sinceWhReconfig >= WEBHOOK_RECONFIG_WINDOW_SEC) {
        if (sinceRestart >= RESTART_COOLDOWN_SEC) {
          try {
            const restartRes = $http.send({
              url: apiUrl + '/instance/restart/' + instanceName,
              method: 'POST',
              headers: headers,
              timeout: 15,
            })
            $app
              .logger()
              .info(
                'health_check_restart',
                'instance',
                instanceName,
                'status',
                restartRes.statusCode,
              )

            let webhookUrl = $secrets.get('PB_WEBHOOK_URL') || ''
            if (!webhookUrl) {
              const instanceUrl = $secrets.get('PB_INSTANCE_URL') || ''
              if (instanceUrl) {
                webhookUrl =
                  (instanceUrl.endsWith('/') ? instanceUrl.slice(0, -1) : instanceUrl) +
                  '/backend/v1/whatsapp/webhook'
              }
            }
            if (webhookUrl) {
              try {
                $http.send({
                  url: apiUrl + '/webhook/set/' + instanceName,
                  method: 'POST',
                  headers: headers,
                  body: JSON.stringify({
                    enabled: true,
                    url: webhookUrl,
                    byEvents: false,
                    base64: true,
                    events: webhookEvents,
                  }),
                  timeout: 15,
                })
              } catch (whErr) {
                $app
                  .logger()
                  .warn(
                    'health_check_restart_webhook_error',
                    'instance',
                    instanceName,
                    'error',
                    String(whErr),
                  )
              }
            }

            instance.set('last_instance_restart_at', nowDateStr)
            instance.set('last_webhook_reconfigured_at', nowDateStr)
            didRecovery = true
          } catch (err) {
            $app
              .logger()
              .error('health_check_restart_error', 'instance', instanceName, 'error', String(err))
          }
        } else {
          try {
            let webhookUrl = $secrets.get('PB_WEBHOOK_URL') || ''
            if (!webhookUrl) {
              const instanceUrl = $secrets.get('PB_INSTANCE_URL') || ''
              if (instanceUrl) {
                webhookUrl =
                  (instanceUrl.endsWith('/') ? instanceUrl.slice(0, -1) : instanceUrl) +
                  '/backend/v1/whatsapp/webhook'
              }
            }
            if (webhookUrl) {
              const resSetWh = $http.send({
                url: apiUrl + '/webhook/set/' + instanceName,
                method: 'POST',
                headers: headers,
                body: JSON.stringify({
                  enabled: true,
                  url: webhookUrl,
                  byEvents: false,
                  base64: true,
                  events: webhookEvents,
                }),
                timeout: 15,
              })
              $app
                .logger()
                .info(
                  'health_check_webhook_reconfigured',
                  'instance',
                  instanceName,
                  'status',
                  resSetWh.statusCode,
                )
            }
            instance.set('last_webhook_reconfigured_at', nowDateStr)
            didRecovery = true
          } catch (err) {
            $app
              .logger()
              .error(
                'health_check_webhook_reconfig_error',
                'instance',
                instanceName,
                'error',
                String(err),
              )
          }
        }
      }

      if (didRecovery) {
        instance.set('health_check_failures', (instance.getInt('health_check_failures') || 0) + 1)
      } else {
        $app
          .logger()
          .info(
            'health_check_recovery_in_progress',
            'instance',
            instanceName,
            'sinceWhReconfig',
            sinceWhReconfig,
            'sinceRestart',
            sinceRestart,
          )
      }

      $app.save(instance)
    } catch (err) {
      $app.logger().warn('health_check_instance_error', 'error', String(err))
    }
  }
})
