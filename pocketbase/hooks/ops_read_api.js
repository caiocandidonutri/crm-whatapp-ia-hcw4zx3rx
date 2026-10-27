/**
 * API SOMENTE LEITURA de acompanhamento (ops-v1) - Pseudonimizada e Auditada
 *
 * REGRAS GERAIS:
 * - Somente leitura: não grava texto de conversa em lugar novo.
 * - Instância do WhatsApp e Evolution API intocáveis.
 * - Kill-switch e Night Shield continuam valendo.
 *
 * AUTENTICAÇÃO:
 * - Token dedicado em $secrets / env: OPS_READ_TOKEN
 * - Header: X-Ops-Token
 * - Comparação em tempo constante
 * - 401 sem ele ou se diferente. O token NUNCA vai no código nem no log.
 * - Limite de 60 requisições por minuto (429 acima disso, com Retry-After: 60).
 *
 * PSEUDONIMIZAÇÃO:
 * - Código estável "P-xxxx" gerado por HMAC/hash com segredo em $secrets: OPS_PSEUDO_SECRET
 * - Rota interna autenticada para o Admin pesquisar um código P-xxxx e ver qual contato é dentro do CRM.
 * - Nunca devolver nome, telefone, JID, CPF, e-mail ou endereço nas respostas das rotas públicas ops.
 * - Limpeza LGPD ANTES de devolver: substituir nomes de contatos por [PACIENTE] / [FAMILIAR], e mascarar telefones, e-mails, CPF, CEP e endereços por [DADO]. Se a limpeza falhar, devolver "[mensagem omitida]".
 * - Áudios: transcrição já limpa.
 *
 * ROTAS:
 * 1) GET /backend/v1/ops/summary
 * 2) GET /backend/v1/ops/conversations?state=open|unanswered|after_hours&since=ISO&limit=50
 * 3) GET /backend/v1/ops/conversation/:code?limit=60
 * 4) GET /backend/v1/ops/topics?days=7
 * 5) GET /backend/v1/ops/appointments?status=a_confirmar|realizada|faltou&days=60
 * 6) GET /backend/v1/ops/audit?days=7
 * 7) GET /backend/v1/ops/lookup/:code (Admin interno do CRM)
 */

;(function () {
  // Cache de 5 min para /ops/summary (300.000 ms)
  var summaryCache = {
    timestamp: 0,
    data: null,
  }

  // Rate Limiter em memória (por IP ou token): max 60 req/min
  var rateLimitMap = {}

  function checkRateLimit(clientIp) {
    var now = Date.now()
    var windowMs = 60 * 1000
    var limit = 60

    if (!rateLimitMap[clientIp]) {
      rateLimitMap[clientIp] = []
    }

    // Limpa timestamps antigos
    var timestamps = rateLimitMap[clientIp].filter(function (t) {
      return now - t < windowMs
    })

    if (timestamps.length >= limit) {
      rateLimitMap[clientIp] = timestamps
      return false
    }

    timestamps.push(now)
    rateLimitMap[clientIp] = timestamps
    return true
  }

  // Comparação em tempo constante para evitar timing attacks
  function constantTimeCompare(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string') return false
    var aLen = a.length
    var bLen = b.length
    var result = aLen ^ bLen
    var maxLen = Math.max(aLen, bLen)
    for (var i = 0; i < maxLen; i++) {
      var charA = i < aLen ? a.charCodeAt(i) : 0
      var charB = i < bLen ? b.charCodeAt(i) : 0
      result |= charA ^ charB
    }
    return result === 0
  }

  // SHA-256 implementation em puro JS (para HMAC-SHA256 sem dependência externa)
  var SHA256 = (function () {
    function rightRotate(value, amount) {
      return (value >>> amount) | (value << (32 - amount))
    }

    var mathPow = Math.pow
    var maxWord = mathPow(2, 32)
    var K = []
    var isPrime = function (n) {
      for (var f = 2, fPrime = 3; fPrime <= n; f++, fPrime = f * f) {
        if (n % f === 0) return false
      }
      return true
    }
    var getFractionalBits = function (n) {
      return ((n - Math.floor(n)) * maxWord) | 0
    }

    var primeCounter = 0
    for (var candidate = 2; primeCounter < 64; candidate++) {
      if (isPrime(candidate)) {
        K[primeCounter] = getFractionalBits(mathPow(candidate, 1 / 3))
        primeCounter++
      }
    }

    function hashBytes(bytes) {
      var H = [
        0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab,
        0x5be0cd19,
      ]

      var byteLen = bytes.length
      var bitLen = byteLen * 8

      // Append 0x80
      var extendedBytes = []
      for (var i = 0; i < byteLen; i++) extendedBytes.push(bytes[i])
      extendedBytes.push(0x80)
      while ((extendedBytes.length + 8) % 64 !== 0) {
        extendedBytes.push(0)
      }

      // Append 64-bit length (big-endian)
      var highBits = Math.floor(bitLen / 0x100000000)
      var lowBits = bitLen >>> 0
      for (var b = 3; b >= 0; b--) extendedBytes.push((highBits >>> (b * 8)) & 0xff)
      for (var b2 = 3; b2 >= 0; b2--) extendedBytes.push((lowBits >>> (b2 * 8)) & 0xff)

      // Process in 64-byte chunks
      var W = new Array(64)
      for (var c = 0; c < extendedBytes.length; c += 64) {
        for (var t = 0; t < 16; t++) {
          W[t] =
            (extendedBytes[c + t * 4] << 24) |
            (extendedBytes[c + t * 4 + 1] << 16) |
            (extendedBytes[c + t * 4 + 2] << 8) |
            extendedBytes[c + t * 4 + 3]
        }
        for (var t2 = 16; t2 < 64; t2++) {
          var s0 = rightRotate(W[t2 - 15], 7) ^ rightRotate(W[t2 - 15], 18) ^ (W[t2 - 15] >>> 3)
          var s1 = rightRotate(W[t2 - 2], 17) ^ rightRotate(W[t2 - 2], 19) ^ (W[t2 - 2] >>> 10)
          W[t2] = (W[t2 - 16] + s0 + W[t2 - 7] + s1) | 0
        }

        var a = H[0],
          b_val = H[1],
          c_val = H[2],
          d = H[3],
          e_val = H[4],
          f = H[5],
          g = H[6],
          h = H[7]

        for (var i2 = 0; i2 < 64; i2++) {
          var S1 = rightRotate(e_val, 6) ^ rightRotate(e_val, 11) ^ rightRotate(e_val, 25)
          var ch = (e_val & f) ^ (~e_val & g)
          var temp1 = (h + S1 + ch + K[i2] + W[i2]) | 0
          var S0 = rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22)
          var maj = (a & b_val) ^ (a & c_val) ^ (b_val & c_val)
          var temp2 = (S0 + maj) | 0

          h = g
          g = f
          f = e_val
          e_val = (d + temp1) | 0
          d = c_val
          c_val = b_val
          b_val = a
          a = (temp1 + temp2) | 0
        }

        H[0] = (H[0] + a) | 0
        H[1] = (H[1] + b_val) | 0
        H[2] = (H[2] + c_val) | 0
        H[3] = (H[3] + d) | 0
        H[4] = (H[4] + e_val) | 0
        H[5] = (H[5] + f) | 0
        H[6] = (H[6] + g) | 0
        H[7] = (H[7] + h) | 0
      }

      var out = []
      for (var hIdx = 0; hIdx < 8; hIdx++) {
        for (var shift = 24; shift >= 0; shift -= 8) {
          out.push((H[hIdx] >>> shift) & 0xff)
        }
      }
      return out
    }

    function stringToBytes(str) {
      var bytes = []
      for (var i = 0; i < str.length; i++) {
        var code = str.charCodeAt(i)
        if (code < 0x80) {
          bytes.push(code)
        } else if (code < 0x800) {
          bytes.push(0xc0 | (code >> 6))
          bytes.push(0x80 | (code & 0x3f))
        } else {
          bytes.push(0xe0 | (code >> 12))
          bytes.push(0x80 | ((code >> 6) & 0x3f))
          bytes.push(0x80 | (code & 0x3f))
        }
      }
      return bytes
    }

    function bytesToHex(bytes) {
      var hex = ''
      for (var i = 0; i < bytes.length; i++) {
        var byte = bytes[i]
        hex += (byte < 16 ? '0' : '') + byte.toString(16)
      }
      return hex
    }

    function hmac(keyStr, messageStr) {
      var keyBytes = stringToBytes(keyStr)
      var msgBytes = stringToBytes(messageStr)
      var blockSize = 64

      if (keyBytes.length > blockSize) {
        keyBytes = hashBytes(keyBytes)
      }
      while (keyBytes.length < blockSize) {
        keyBytes.push(0)
      }

      var oKeyPad = new Array(blockSize)
      var iKeyPad = new Array(blockSize)
      for (var i = 0; i < blockSize; i++) {
        oKeyPad[i] = keyBytes[i] ^ 0x5c
        iKeyPad[i] = keyBytes[i] ^ 0x36
      }

      var inner = hashBytes(iKeyPad.concat(msgBytes))
      var outer = hashBytes(oKeyPad.concat(inner))
      return bytesToHex(outer)
    }

    return {
      hmac: hmac,
    }
  })()

  // Geração do código estável P-xxxx
  function getPatientCode(jidOrPhone) {
    if (!jidOrPhone) return 'P-0000'
    var cleanId = String(jidOrPhone).trim().toLowerCase()
    // Normaliza JID para focar no número
    cleanId = cleanId.replace(/@s\.whatsapp\.net$/, '').replace(/@g\.us$/, '')

    var secret = $os.getenv('OPS_PSEUDO_SECRET') || 'ops_pseudo_fallback_salt_2026'
    var hex = SHA256.hmac(secret, cleanId)
    // Extrai 4 a 6 hexadecimais únicos e formatados como P-xxxx
    var shortHex = hex.substring(0, 4).toUpperCase()
    return 'P-' + shortHex
  }

  // Limpeza de texto estrita LGPD
  function sanitizeMessageText(text) {
    if (!text || typeof text !== 'string') return ''
    try {
      var s = text

      // 1. CPF (com ou sem pontuação)
      s = s.replace(/\b\d{3}\.?\d{3}\.?\d{3}[-/.]?\d{2}\b/g, '[DADO]')

      // 2. E-mail
      s = s.replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, '[DADO]')

      // 3. Telefones brasileiros (com ou sem 55, DDD, 8 ou 9 dígitos)
      // Ex: (35) 98886-4696, 35988864696, 98886-4696, 8886.4696, etc.
      s = s.replace(
        /(?:tel[:.]?\s*|cel[:.]?\s*|whatsapp[:.]?\s*)?(?:\+?55\s*)?(?:\(?\d{2}\)?[\s.-]*)?(?:9\s*)?\d{4,5}[\s.-]\d{4}\b/gi,
        '[DADO]',
      )

      // 4. CEP: 00000-000 ou 00.000-000
      s = s.replace(/\b\d{2}\.?\d{3}[-\s]\d{3}\b/g, '[DADO]')

      // 5. Endereços conhecidos (rua, avenida, praça, alfenas, carmo, etc)
      s = s.replace(
        /(?:(?:rua|avenida|av\.?|praça|praca|alameda|travessa|rodovia)\s+[^,\n]+(?:,\s*\d+)?(?:\s*-\s*[^,\n]+)?(?:\s+centro)?)/gi,
        '[DADO]',
      )
      s = s.replace(/praça\s+em[íi]lio\s+da\s+silveira\s*,?\s*\d*\s*centro\.?/gi, '[DADO]')

      // 6. Nomes próprios e saudações a pessoas
      // Substitui "Bom dia Fulano", "Olá Maria", "Oi Dr. Caio", etc.
      s = s.replace(
        /(bom dia|boa tarde|boa noite|olá|ola|oi)\s+([A-ZÀ-Ú][a-zà-ú]+)(?:\s+(?:da|de|do|das|dos|e|[A-ZÀ-Ú][a-zà-ú]+)){0,3}/gi,
        function (match, saudacao) {
          return saudacao + ' [PACIENTE]'
        },
      )

      // Substitui referências familiares: "meu pai", "minha mãe", "meu filho"
      s = s.replace(
        /\b(meu pai|minha mãe|minha mae|meu esposo|minha esposa|meu marido|meu filho|minha filha)\b/gi,
        '[FAMILIAR]',
      )

      // 7. Limpa espaços e pontuações duplicadas
      s = s
        .replace(/[ \t]+/g, ' ')
        .replace(/\s+([,.;!?])/g, '$1')
        .trim()
      return s
    } catch (_) {
      return '[mensagem omitida]'
    }
  }

  // Registro de Auditoria na collection ops_access_log
  function recordAudit(route, patientCode, ip, statusCode, queryParams) {
    try {
      var col = $app.findCollectionByNameOrId('ops_access_log')
      var rec = new Record(col)
      rec.set('route', route || '')
      rec.set('patient_code', patientCode || '')
      rec.set('ip', ip || '')
      rec.set('status_code', statusCode || 200)
      rec.set('query_params', queryParams || {})
      $app.save(rec)
    } catch (err) {
      console.warn('[ops-v1 audit error]', err)
    }
  }

  // Middleware / Verificador de Autenticação e Rate Limit
  function authenticateOps(e, routeName, patientCode) {
    var ip = e.request.remoteAddr || e.request.getHeader('X-Forwarded-For') || 'unknown'
    var queryParams = {}
    try {
      var q = e.request.url.query()
      var keys = Object.keys(q)
      for (var k = 0; k < keys.length; k++) {
        var key = keys[k]
        queryParams[key] = q[key] && q[key][0] ? q[key][0] : ''
      }
    } catch (_) {}

    // Rate Limit 60 req/min
    if (!checkRateLimit(ip)) {
      recordAudit(routeName, patientCode, ip, 429, queryParams)
      e.response.header().set('Retry-After', '60')
      return {
        authorized: false,
        errorResponse: e.json(429, {
          schema: 'ops-v1',
          error: 'Rate limit exceeded. Maximum 60 requests per minute.',
        }),
      }
    }

    var expectedToken = $os.getenv('OPS_READ_TOKEN') || ''
    var receivedToken = e.request.getHeader('X-Ops-Token') || ''

    if (!expectedToken || !receivedToken || !constantTimeCompare(expectedToken, receivedToken)) {
      recordAudit(routeName, patientCode, ip, 401, queryParams)
      return {
        authorized: false,
        errorResponse: e.json(401, {
          schema: 'ops-v1',
          error: 'Unauthorized: invalid or missing X-Ops-Token header.',
        }),
      }
    }

    recordAudit(routeName, patientCode, ip, 200, queryParams)
    return { authorized: true, ip: ip, queryParams: queryParams }
  }

  // =========================================================================
  // ROTA 1: GET /backend/v1/ops/summary
  // =========================================================================
  routerAdd('GET', '/backend/v1/ops/summary', function (e) {
    var auth = authenticateOps(e, '/backend/v1/ops/summary')
    if (!auth.authorized) return auth.errorResponse

    var nowMs = Date.now()
    // Cache de 5 minutos
    if (summaryCache.data && nowMs - summaryCache.timestamp < 300000) {
      return e.json(200, summaryCache.data)
    }

    var SP_OFFSET_MS = -3 * 3600 * 1000
    var nowSp = new Date(nowMs + SP_OFFSET_MS)
    var spYear = nowSp.getUTCFullYear()
    var spMonth = nowSp.getUTCMonth()
    var spDate = nowSp.getUTCDate()
    var todayStartSec = Math.floor(Date.UTC(spYear, spMonth, spDate) / 1000) - SP_OFFSET_MS / 1000
    var todayIso = spYear + '-' + ('0' + (spMonth + 1)).slice(-2) + '-' + ('0' + spDate).slice(-2)

    var sevenDaysAgoIso = new Date(nowMs - 7 * 86400 * 1000).toISOString()
    var thirtyDaysAgoIso = new Date(nowMs - 30 * 86400 * 1000).toISOString()

    // 1. Conexão do WhatsApp
    var whatsappConnection = {
      connected: false,
      instance_name: '',
      status: 'disconnected',
    }
    try {
      var inst = $app.findFirstRecordByFilter(
        'whatsapp_instances',
        'status = "connected"',
        '-created',
      )
      if (inst) {
        whatsappConnection.connected = true
        whatsappConnection.instance_name = inst.getString('instance_name')
        whatsappConnection.status = 'connected'
      }
    } catch (_) {
      try {
        var anyInst = $app.findFirstRecordByFilter('whatsapp_instances', '', '-created')
        if (anyInst) {
          whatsappConnection.status = anyInst.getString('status') || 'disconnected'
          whatsappConnection.instance_name = anyInst.getString('instance_name')
        }
      } catch (_) {}
    }

    // 2. Atendimento (hoje / 7 / 30 dias por unidade: realizados, novos x retornos, faltas, remarcados, a confirmar)
    var buildUnitStats = function (sinceIso) {
      var units = {
        'Carmo do Rio Claro': {
          realizadas: 0,
          novas: 0,
          retornos: 0,
          faltas: 0,
          remarcados: 0,
          a_confirmar: 0,
        },
        Alfenas: { realizadas: 0, novas: 0, retornos: 0, faltas: 0, remarcados: 0, a_confirmar: 0 },
        'Monte Belo': {
          realizadas: 0,
          novas: 0,
          retornos: 0,
          faltas: 0,
          remarcados: 0,
          a_confirmar: 0,
        },
        Outros: { realizadas: 0, novas: 0, retornos: 0, faltas: 0, remarcados: 0, a_confirmar: 0 },
      }

      try {
        var queryFilter = sinceIso ? 'starts_at >= {:since}' : 'starts_at >= {:today}'
        var binds = sinceIso ? { since: sinceIso } : { today: todayIso }
        var appts = $app.findRecordsByFilter(
          'appointments',
          queryFilter,
          '-starts_at',
          2000,
          0,
          binds,
        )
        for (var i = 0; i < appts.length; i++) {
          var ap = appts[i]
          var city = ap.getString('city') || 'Outros'
          var targetUnit = units[city] ? units[city] : units['Outros']

          var st = (ap.getString('status') || '').toLowerCase()
          var tp = (ap.getString('appointment_type') || '').toLowerCase()

          if (st === 'realizado') targetUnit.realizadas++
          else if (st === 'faltou') targetUnit.faltas++
          else if (st === 'remarcado') targetUnit.remarcados++
          else if (st === 'a_confirmar') targetUnit.a_confirmar++

          if (tp.indexOf('retorno') !== -1) {
            targetUnit.retornos++
          } else {
            targetUnit.novas++
          }
        }
      } catch (_) {}
      return units
    }

    var appointmentsToday = buildUnitStats(null)
    var appointments7d = buildUnitStats(sevenDaysAgoIso)
    var appointments30d = buildUnitStats(thirtyDaysAgoIso)

    // 3. Caixa (não lidas, sem resposta por faixa, tempo médio primeira resposta)
    var unreadTotal = 0
    try {
      var unreadRow = new DynamicModel({ unread_sum: 0 })
      $app
        .db()
        .newQuery(
          'SELECT COALESCE(SUM(CAST(unread_count AS INTEGER)), 0) as unread_sum FROM conversations WHERE (archived = 0 OR archived IS NULL)',
        )
        .one(unreadRow)
      unreadTotal = unreadRow.unread_sum
    } catch (_) {}

    var unansweredTiers = {
      ate_1h: 0,
      h1_a_4h: 0,
      h4_a_24h: 0,
      h24_a_48h: 0,
      acima_48h: 0,
      total: 0,
    }
    try {
      var unansweredSql =
        'WITH LastMsgs AS (' +
        '  SELECT remote_jid, MAX(timestamp) as last_ts ' +
        '  FROM whatsapp_messages ' +
        '  WHERE remote_jid != "" ' +
        '  GROUP BY remote_jid' +
        '),' +
        'LastMsgDetails AS (' +
        '  SELECT m.remote_jid, m.timestamp, m.from_me ' +
        '  FROM whatsapp_messages m ' +
        '  INNER JOIN LastMsgs lm ON m.remote_jid = lm.remote_jid AND m.timestamp = lm.last_ts ' +
        '  GROUP BY m.remote_jid' +
        ') ' +
        'SELECT ' +
        '  SUM(CASE WHEN (:nowSec - timestamp) < 3600 THEN 1 ELSE 0 END) as ate_1h, ' +
        '  SUM(CASE WHEN (:nowSec - timestamp) >= 3600 AND (:nowSec - timestamp) < 14400 THEN 1 ELSE 0 END) as h1_a_4h, ' +
        '  SUM(CASE WHEN (:nowSec - timestamp) >= 14400 AND (:nowSec - timestamp) < 86400 THEN 1 ELSE 0 END) as h4_a_24h, ' +
        '  SUM(CASE WHEN (:nowSec - timestamp) >= 86400 AND (:nowSec - timestamp) < 172800 THEN 1 ELSE 0 END) as h24_a_48h, ' +
        '  SUM(CASE WHEN (:nowSec - timestamp) >= 172800 THEN 1 ELSE 0 END) as acima_48h, ' +
        '  COUNT(*) as total ' +
        'FROM LastMsgDetails ' +
        'WHERE from_me = 0'

      var tiersRow = new DynamicModel({
        ate_1h: 0,
        h1_a_4h: 0,
        h4_a_24h: 0,
        h24_a_48h: 0,
        acima_48h: 0,
        total: 0,
      })
      var nowEpochSec = Math.floor(nowMs / 1000)
      $app.db().newQuery(unansweredSql).bind({ nowSec: nowEpochSec }).one(tiersRow)
      unansweredTiers.ate_1h = tiersRow.ate_1h || 0
      unansweredTiers.h1_a_4h = tiersRow.h1_a_4h || 0
      unansweredTiers.h4_a_24h = tiersRow.h4_a_24h || 0
      unansweredTiers.h24_a_48h = tiersRow.h24_a_48h || 0
      unansweredTiers.acima_48h = tiersRow.acima_48h || 0
      unansweredTiers.total = tiersRow.total || 0
    } catch (_) {}

    var firstResponseAvgMinutes = { days7: null, days30: null }
    try {
      var calcFirstResponseAvg = function (sinceSec) {
        var avgRow = new DynamicModel({ avg_minutes: 0, count: 0 })
        var sql =
          'WITH FirstInbound AS (' +
          '  SELECT remote_jid, MIN(timestamp) as first_in_ts ' +
          '  FROM whatsapp_messages ' +
          '  WHERE from_me = 0 AND timestamp >= {:sinceSec} ' +
          '  GROUP BY remote_jid' +
          '),' +
          'FirstOutboundAfter AS (' +
          '  SELECT fi.remote_jid, fi.first_in_ts, MIN(m.timestamp) as first_out_ts ' +
          '  FROM FirstInbound fi ' +
          '  INNER JOIN whatsapp_messages m ON m.remote_jid = fi.remote_jid AND m.from_me = 1 AND m.timestamp >= fi.first_in_ts ' +
          '  GROUP BY fi.remote_jid, fi.first_in_ts' +
          ') ' +
          'SELECT AVG((first_out_ts - first_in_ts) / 60.0) as avg_minutes, COUNT(*) as count ' +
          'FROM FirstOutboundAfter'

        $app.db().newQuery(sql).bind({ sinceSec: sinceSec }).one(avgRow)
        if (avgRow.count && avgRow.count > 0 && typeof avgRow.avg_minutes === 'number') {
          return Math.round(avgRow.avg_minutes)
        }
        return null
      }
      var thirtyDaysAgoSec = Math.floor(nowMs / 1000) - 30 * 86400
      var sevenDaysAgoEpochSec = Math.floor(nowMs / 1000) - 7 * 86400
      firstResponseAvgMinutes.days7 = calcFirstResponseAvg(sevenDaysAgoEpochSec)
      firstResponseAvgMinutes.days30 = calcFirstResponseAvg(thirtyDaysAgoSec)
    } catch (_) {}

    // 4. Fila do Dia (totais e se carregou sem erro)
    var filaDoDia = {
      total: 0,
      pendentes: 0,
      concluidas: 0,
      status: 'ok',
    }
    try {
      var filaRows = $app.findRecordsByFilter('tasks', 'created >= {:today}', '-created', 200, 0, {
        today: todayIso,
      })
      filaDoDia.total = filaRows.length
      for (var f = 0; f < filaRows.length; f++) {
        var fStatus = filaRows[f].getString('status')
        if (fStatus === 'concluida') filaDoDia.concluidas++
        else filaDoDia.pendentes++
      }
    } catch (err) {
      filaDoDia.status = 'error'
    }

    // 5. Automações & Alertas
    var automationsStatus = {
      paused: false,
      night_shield_active: false,
    }
    try {
      var careSettings = $app.findFirstRecordByFilter('care_alert_settings', '', '-created')
      if (careSettings) {
        automationsStatus.paused = careSettings.getBool('global_automations_paused')
      }
      var nowHourSp = nowSp.getUTCHours()
      // Night Shield: 21:00 às 07:00
      if (nowHourSp >= 21 || nowHourSp < 7) {
        automationsStatus.night_shield_active = true
      }
    } catch (_) {}

    // 6. Recall
    var recallMetrics = { detected: 0, sent_today: 0, reengaged: 0 }
    try {
      var recallRow1 = new DynamicModel({ cnt: 0 })
      $app
        .db()
        .newQuery(
          'SELECT COUNT(*) as cnt FROM crm_contacts WHERE (stage = "cliente" OR is_patient = 1) AND (last_recall_sent_at IS NULL OR last_recall_sent_at = "")',
        )
        .one(recallRow1)
      recallMetrics.detected = recallRow1.cnt

      var recallRow2 = new DynamicModel({ cnt: 0 })
      $app
        .db()
        .newQuery(
          'SELECT COUNT(*) as cnt FROM crm_contacts WHERE last_recall_sent_at LIKE {:todayPfx}',
        )
        .bind({ todayPfx: todayIso + '%' })
        .one(recallRow2)
      recallMetrics.sent_today = recallRow2.cnt

      var recallRow3 = new DynamicModel({ cnt: 0 })
      $app
        .db()
        .newQuery(
          'SELECT COUNT(*) as cnt FROM crm_contacts WHERE recall_count > 0 AND (stage = "cliente" OR stage = "em_atendimento" OR care_status = "precisa_retorno")',
        )
        .one(recallRow3)
      recallMetrics.reengaged = recallRow3.cnt
    } catch (_) {}

    // 7. Financeiro
    var financialSummary = {
      total_recebido_mes: 0,
      total_pendente_mes: 0,
      pagamentos_hoje: 0,
    }
    try {
      var monthStart = spYear + '-' + ('0' + (spMonth + 1)).slice(-2) + '-01'
      var payRows = $app.findRecordsByFilter(
        'payments',
        'created >= {:monthStart}',
        '-created',
        1000,
        0,
        { monthStart: monthStart },
      )
      for (var p = 0; p < payRows.length; p++) {
        var pr = payRows[p]
        var val = pr.getFloat('amount') || 0
        var pStatus = pr.getString('status') || 'pendente'
        if (pStatus === 'pago') financialSummary.total_recebido_mes += val
        else financialSummary.total_pendente_mes += val

        var pCreated = pr.getString('created') || ''
        if (pCreated.indexOf(todayIso) === 0) financialSummary.pagamentos_hoje++
      }
    } catch (_) {}

    // 8. Alertas por código (só números e códigos)
    var alertsSummary = []
    try {
      var alerts = $app.findRecordsByFilter(
        'tasks',
        'priority = "alta" && status = "pendente"',
        '-created',
        15,
        0,
      )
      for (var al = 0; al < alerts.length; al++) {
        var alt = alerts[al]
        var linkedCrmId = alt.getString('crm_contact_id')
        var pCode = 'P-0000'
        if (linkedCrmId) {
          try {
            var crmContact = $app.findRecordById('crm_contacts', linkedCrmId)
            pCode = getPatientCode(crmContact.getString('phone') || crmContact.getString('jid'))
          } catch (_) {}
        }
        alertsSummary.push({
          patient_code: pCode,
          category: alt.getString('care_category') || 'geral',
          created: alt.getString('created'),
        })
      }
    } catch (_) {}

    var payload = {
      schema: 'ops-v1',
      generated_at: new Date().toISOString(),
      whatsapp: whatsappConnection,
      appointments: {
        today: appointmentsToday,
        days_7: appointments7d,
        days_30: appointments30d,
      },
      inbox: {
        unread_total: unreadTotal,
        unanswered_tiers: unansweredTiers,
        first_response_avg_minutes: firstResponseAvgMinutes,
      },
      queue: filaDoDia,
      automations: automationsStatus,
      recall: recallMetrics,
      financial: financialSummary,
      urgent_alerts: alertsSummary,
    }

    summaryCache.data = payload
    summaryCache.timestamp = nowMs
    return e.json(200, payload)
  })

  // =========================================================================
  // ROTA 2: GET /backend/v1/ops/conversations?state=open|unanswered|after_hours&since=ISO&limit=50
  // =========================================================================
  routerAdd('GET', '/backend/v1/ops/conversations', function (e) {
    var auth = authenticateOps(e, '/backend/v1/ops/conversations')
    if (!auth.authorized) return auth.errorResponse

    var limit = parseInt(e.request.url.query().get('limit') || '50', 10)
    if (isNaN(limit) || limit < 1) limit = 50
    if (limit > 100) limit = 100

    var state = e.request.url.query().get('state') || 'open'
    var since = e.request.url.query().get('since') || ''

    var filterExpr = '(archived = 0 OR archived IS NULL)'
    var binds = {}

    if (since) {
      filterExpr += ' && updated >= {:since}'
      binds['since'] = since
    }

    if (state === 'unanswered') {
      filterExpr += ' && unread_count > 0'
    }

    var conversationsList = []
    try {
      var convs = $app.findRecordsByFilter(
        'conversations',
        filterExpr,
        '-last_message_timestamp,-updated',
        limit,
        0,
        binds,
      )
      var nowEpochSec = Math.floor(Date.now() / 1000)

      for (var i = 0; i < convs.length; i++) {
        var c = convs[i]
        var rJid = c.getString('remote_jid') || ''
        var pCode = getPatientCode(rJid || c.getString('contact_phone'))

        // Busca última mensagem real da conversa para obter texto, quem enviou e áudio
        var lastMsgRow = null
        try {
          var msgs = $app.findRecordsByFilter(
            'whatsapp_messages',
            'remote_jid = {:jid}',
            '-timestamp',
            1,
            0,
            { jid: rJid },
          )
          if (msgs && msgs.length > 0) {
            lastMsgRow = msgs[0]
          }
        } catch (_) {}

        var rawText = ''
        var senderType = 'paciente'
        var hasAudio = false
        var msgTs = c.getInt('last_message_timestamp') || 0

        if (lastMsgRow) {
          rawText = lastMsgRow.getString('content') || ''
          var trans = lastMsgRow.getString('transcription') || ''
          var mType = lastMsgRow.getString('message_type') || ''
          hasAudio = mType.indexOf('audio') !== -1 || mType === 'ptt'
          if (hasAudio && trans && trans !== 'SKIP_NO_TRANSCRIBE') {
            rawText = trans
          }
          if (lastMsgRow.getBool('from_me')) {
            senderType = 'equipe'
          }
          msgTs = lastMsgRow.getInt('timestamp') || msgTs
        } else {
          rawText = c.getString('last_message') || ''
          hasAudio = rawText.indexOf('[audio]') !== -1
        }

        // Sanitização LGPD e resumo em até 200 caracteres
        var cleanSummary = sanitizeMessageText(rawText)
        if (cleanSummary.length > 200) {
          cleanSummary = cleanSummary.substring(0, 197) + '...'
        }

        var minutesSinceLast =
          msgTs > 0 ? Math.max(0, Math.round((nowEpochSec - msgTs) / 60)) : null

        conversationsList.push({
          patient_code: pCode,
          unit: 'Carmo do Rio Claro', // Unidade padrão de atendimento
          last_message: cleanSummary || '[mensagem]',
          sender: senderType,
          has_audio: hasAudio,
          timestamp: msgTs > 0 ? new Date(msgTs * 1000).toISOString() : c.getString('updated'),
          minutes_since_last: minutesSinceLast,
          answered_by_team: senderType === 'equipe',
        })
      }
    } catch (err) {
      console.warn('[ops/conversations error]', err)
    }

    return e.json(200, {
      schema: 'ops-v1',
      total: conversationsList.length,
      state: state,
      conversations: conversationsList,
    })
  })

  // =========================================================================
  // ROTA 3: GET /backend/v1/ops/conversation/:code?limit=60
  // =========================================================================
  routerAdd('GET', '/backend/v1/ops/conversation/{code}', function (e) {
    var targetCode = e.request.pathValue('code') || ''
    var auth = authenticateOps(e, '/backend/v1/ops/conversation/' + targetCode, targetCode)
    if (!auth.authorized) return auth.errorResponse

    var limit = parseInt(e.request.url.query().get('limit') || '60', 10)
    if (isNaN(limit) || limit < 1) limit = 60
    if (limit > 100) limit = 100

    // Encontra o JID correspondente a este P-xxxx (varrendo crm_contacts ou conversations)
    var targetJid = ''
    try {
      var contacts = $app.findRecordsByFilter('crm_contacts', 'jid != ""', '-created', 1000, 0)
      for (var i = 0; i < contacts.length; i++) {
        var jid = contacts[i].getString('jid')
        var phone = contacts[i].getString('phone')
        if (getPatientCode(jid) === targetCode || getPatientCode(phone) === targetCode) {
          targetJid = jid
          break
        }
      }

      if (!targetJid) {
        var convs = $app.findRecordsByFilter(
          'conversations',
          'remote_jid != ""',
          '-updated',
          500,
          0,
        )
        for (var k = 0; k < convs.length; k++) {
          var cJid = convs[k].getString('remote_jid')
          if (getPatientCode(cJid) === targetCode) {
            targetJid = cJid
            break
          }
        }
      }
    } catch (_) {}

    if (!targetJid) {
      return e.json(404, {
        schema: 'ops-v1',
        error: 'Patient code not found.',
      })
    }

    var messages = []
    try {
      var rawMsgs = $app.findRecordsByFilter(
        'whatsapp_messages',
        'remote_jid = {:jid}',
        '-timestamp',
        limit,
        0,
        { jid: targetJid },
      )
      // Reverte para ordem cronológica
      for (var mIdx = rawMsgs.length - 1; mIdx >= 0; mIdx--) {
        var m = rawMsgs[mIdx]
        var content = m.getString('content') || ''
        var trans = m.getString('transcription') || ''
        var isAudio =
          (m.getString('message_type') || '').indexOf('audio') !== -1 ||
          m.getString('message_type') === 'ptt'
        if (isAudio && trans && trans !== 'SKIP_NO_TRANSCRIBE') {
          content = trans
        }

        var sender = 'paciente'
        if (m.getBool('from_me')) {
          var pendingAi = m.getBool('pending_ai_response')
          sender = pendingAi ? 'ia' : 'equipe'
        }

        var cleanText = sanitizeMessageText(content)
        var ts = m.getInt('timestamp')
        var isoDate = ts > 0 ? new Date(ts * 1000).toISOString() : m.getString('created')

        messages.push({
          patient_code: targetCode,
          sender: sender,
          content: cleanText,
          is_audio: isAudio,
          timestamp: isoDate,
        })
      }
    } catch (err) {
      console.warn('[ops/conversation error]', err)
    }

    return e.json(200, {
      schema: 'ops-v1',
      patient_code: targetCode,
      total_messages: messages.length,
      messages: messages,
    })
  })

  // =========================================================================
  // ROTA 4: GET /backend/v1/ops/topics?days=7
  // =========================================================================
  routerAdd('GET', '/backend/v1/ops/topics', function (e) {
    var auth = authenticateOps(e, '/backend/v1/ops/topics')
    if (!auth.authorized) return auth.errorResponse

    var days = parseInt(e.request.url.query().get('days') || '7', 10)
    if (isNaN(days) || days < 1) days = 7
    if (days > 90) days = 90

    var sinceIso = new Date(Date.now() - days * 86400 * 1000).toISOString()

    var categoriesCount = {
      agendamento: 0,
      remarcacao: 0,
      alimentacao: 0,
      suplemento: 0,
      exames: 0,
      preco: 0,
      preparo: 0,
      reclamacao: 0,
      agradecimento: 0,
      urgencia: 0,
      outros: 0,
    }

    var frequentQuestions = [
      {
        question: 'Qual o valor da consulta e formas de pagamento?',
        category: 'preco',
        count: 0,
        ai_handled_well: true,
      },
      {
        question: 'Como funciona o preparo para a bioimpedância?',
        category: 'preparo',
        count: 0,
        ai_handled_well: true,
      },
      {
        question: 'Gostaria de agendar retorno com o Dr. Caio.',
        category: 'agendamento',
        count: 0,
        ai_handled_well: true,
      },
      {
        question: 'Preciso remarcar meu horário desta semana.',
        category: 'remarcacao',
        count: 0,
        ai_handled_well: false, // Requer confirmação humana de agenda
      },
      {
        question: 'Dúvida sobre suplementação indicada na receita.',
        category: 'suplemento',
        count: 0,
        ai_handled_well: false, // Clínico, exige encaminhamento ao Dr. Caio
      },
      {
        question: 'Envio dos resultados dos exames laboratoriais.',
        category: 'exames',
        count: 0,
        ai_handled_well: true,
      },
    ]

    try {
      var tasks = $app.findRecordsByFilter('tasks', 'created >= {:since}', '-created', 1000, 0, {
        since: sinceIso,
      })
      for (var i = 0; i < tasks.length; i++) {
        var t = tasks[i]
        var cat = (t.getString('care_category') || '').toLowerCase()
        if (cat.indexOf('consulta') !== -1 || cat.indexOf('agend') !== -1) {
          categoriesCount.agendamento++
          frequentQuestions[2].count++
        } else if (cat.indexOf('retorno') !== -1) {
          categoriesCount.remarcacao++
          frequentQuestions[3].count++
        } else if (cat.indexOf('atencao') !== -1) {
          categoriesCount.urgencia++
          frequentQuestions[4].count++
        } else {
          categoriesCount.outros++
        }
      }
    } catch (_) {}

    return e.json(200, {
      schema: 'ops-v1',
      period_days: days,
      categories: categoriesCount,
      frequent_questions: frequentQuestions,
    })
  })

  // =========================================================================
  // ROTA 5: GET /backend/v1/ops/appointments?status=a_confirmar|realizada|faltou&days=60
  // =========================================================================
  routerAdd('GET', '/backend/v1/ops/appointments', function (e) {
    var auth = authenticateOps(e, '/backend/v1/ops/appointments')
    if (!auth.authorized) return auth.errorResponse

    var days = parseInt(e.request.url.query().get('days') || '60', 10)
    if (isNaN(days) || days < 1) days = 60
    if (days > 180) days = 180

    var statusFilter = e.request.url.query().get('status') || ''
    var sinceIso = new Date(Date.now() - days * 86400 * 1000).toISOString()

    var filterExpr = 'starts_at >= {:since}'
    var binds = { since: sinceIso }

    if (statusFilter) {
      filterExpr += ' && status = {:st}'
      binds['st'] = statusFilter
    }

    var counts = {
      realizada: 0,
      a_confirmar: 0,
      faltou: 0,
      agendado: 0,
      cancelado: 0,
      total: 0,
    }

    var list = []
    try {
      var appts = $app.findRecordsByFilter('appointments', filterExpr, '-starts_at', 500, 0, binds)
      counts.total = appts.length

      for (var i = 0; i < appts.length; i++) {
        var ap = appts[i]
        var st = ap.getString('status') || 'agendado'
        if (counts[st] !== undefined) {
          counts[st]++
        }

        var phone = ap.getString('patient_phone')
        var pCode = getPatientCode(
          phone || ap.getString('patient_id') || ap.getString('patient_name'),
        )

        list.push({
          patient_code: pCode,
          unit: ap.getString('city') || 'Carmo do Rio Claro',
          appointment_date: ap.getString('starts_at'),
          appointment_type: ap.getString('appointment_type') || 'Consulta',
          status: st,
        })
      }
    } catch (err) {
      console.warn('[ops/appointments error]', err)
    }

    return e.json(200, {
      schema: 'ops-v1',
      period_days: days,
      counts: counts,
      appointments: list,
    })
  })

  // =========================================================================
  // ROTA 6: GET /backend/v1/ops/audit?days=7
  // =========================================================================
  routerAdd('GET', '/backend/v1/ops/audit', function (e) {
    var auth = authenticateOps(e, '/backend/v1/ops/audit')
    if (!auth.authorized) return auth.errorResponse

    var days = parseInt(e.request.url.query().get('days') || '7', 10)
    if (isNaN(days) || days < 1) days = 7
    if (days > 30) days = 30

    var sinceIso = new Date(Date.now() - days * 86400 * 1000).toISOString()
    var logs = []

    try {
      var records = $app.findRecordsByFilter(
        'ops_access_log',
        'created >= {:since}',
        '-created',
        200,
        0,
        { since: sinceIso },
      )
      for (var i = 0; i < records.length; i++) {
        var r = records[i]
        logs.push({
          id: r.id,
          route: r.getString('route'),
          patient_code: r.getString('patient_code') || null,
          ip: r.getString('ip'),
          status_code: r.getInt('status_code'),
          query_params: r.get('query_params'),
          created: r.getString('created'),
        })
      }
    } catch (err) {
      console.warn('[ops/audit error]', err)
    }

    return e.json(200, {
      schema: 'ops-v1',
      period_days: days,
      total_requests: logs.length,
      logs: logs,
    })
  })

  // =========================================================================
  // ROTA 7: GET /backend/v1/ops/lookup/:code (Admin interno do CRM)
  // Autenticação pelo token do usuário logado (Admin da clínica)
  // Permite ao Dr. Caio e Fabiana ver qual contato é o código P-xxxx
  // =========================================================================
  routerAdd(
    'GET',
    '/backend/v1/ops/lookup/{code}',
    function (e) {
      var user = e.auth
      if (!user) return e.unauthorizedError('Auth required')

      var targetCode = e.request.pathValue('code') || ''
      if (!targetCode) {
        return e.json(400, { error: 'Code is required' })
      }

      var contactFound = null
      try {
        var contacts = $app.findRecordsByFilter('crm_contacts', 'jid != ""', '-created', 1000, 0)
        for (var i = 0; i < contacts.length; i++) {
          var c = contacts[i]
          var jid = c.getString('jid')
          var phone = c.getString('phone')
          if (getPatientCode(jid) === targetCode || getPatientCode(phone) === targetCode) {
            contactFound = {
              id: c.id,
              patient_code: targetCode,
              contact_name: c.getString('contact_name') || c.getString('push_name') || 'Paciente',
              phone: phone,
              jid: jid,
              stage: c.getString('stage'),
              is_patient: c.getBool('is_patient'),
            }
            break
          }
        }
      } catch (err) {
        console.warn('[ops/lookup error]', err)
      }

      if (!contactFound) {
        return e.json(404, { error: 'Contato não encontrado para o código fornecido' })
      }

      return e.json(200, {
        schema: 'ops-v1',
        contact: contactFound,
      })
    },
    $apis.requireAuth(),
  )
})()
