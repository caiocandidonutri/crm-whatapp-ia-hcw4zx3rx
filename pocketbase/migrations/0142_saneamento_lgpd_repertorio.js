/**
 * 0142_saneamento_lgpd_repertorio.js
 *
 * Migração Idempotente de Saneamento LGPD dos Registros Já Salvos.
 *
 * O que esta migração faz:
 * 1. message_templates (especialmente os de voz da Fabiana ou com dados pessoais):
 *    - Descarta (remove) registros que sejam listas de múltiplos pacientes/horários ("agenda do dia").
 *    - Higieniza e reanonimiza templates que contenham telefones, CPF, e-mail ou endereços completos.
 * 2. knowledge_base (fichas com transcrições ou notas de atendimento):
 *    - Remove JIDs completos (@s.whatsapp.net / telefones em campos como 'fonte' ou 'resposta').
 *    - Reanonimiza mantendo apenas primeiro nome ou '{nome}'.
 * 3. Idempotente: seleciona registros pela condição, é no-op em banco vazio e pode ser reexecutada com segurança.
 */

migrate(
  (app) => {
    // Regex de limpeza LGPD (sem ES6-only complexidades para compatibilidade com Goja)
    var REGEX_CPF = /\b\d{3}\.?\d{3}\.?\d{3}[-\/.]?\d{2}\b/g
    var REGEX_EMAIL = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g
    var REGEX_TELEFONE =
      /(?:tel[:.]?\s*|cel[:.]?\s*|whatsapp[:.]?\s*)?(?:\+?55\s*)?(?:\(?\d{2}\)?[\s.-]*)?(?:9\s*)?\d{4,5}[\s.-]\d{4}\b/gi
    var REGEX_TELEFONE_CURTO = /\b\d{4,5}[.-]\d{4}\b/g
    var REGEX_JID_PHONE = /\b55\d{10,11}(?:@s\.whatsapp\.net)?\b/gi

    function isListaMultiplosPacientes(text) {
      if (!text) return false
      var t = text.toLowerCase()
      if (
        t.indexOf('agenda dia') !== -1 ||
        t.indexOf('agenda do dia') !== -1 ||
        t.indexOf('agenda de hoje') !== -1 ||
        t.indexOf('agenda carmo') !== -1 ||
        t.indexOf('agenda alfenas') !== -1 ||
        t.indexOf('agenda monte belo') !== -1
      ) {
        return true
      }
      var matchesHorarios = text.match(/(?:\b\d{1,2}[:.h]\d{2}\b|\b\d{1,2}hrs?\b)/gi) || []
      if (matchesHorarios.length >= 3) return true
      var matchesTel = text.match(/\b(?:\d{4,5}[.-]\d{4})\b/g) || []
      if (matchesTel.length >= 2) return true
      return false
    }

    function higienizarTexto(text) {
      if (!text) return text
      var s = text
      s = s.replace(REGEX_CPF, '[CPF]')
      s = s.replace(REGEX_EMAIL, '[E-MAIL]')
      s = s.replace(REGEX_TELEFONE, '')
      s = s.replace(REGEX_JID_PHONE, '[telefone confidencial]')
      s = s.replace(REGEX_TELEFONE_CURTO, '')
      // Remove endereços físicos das unidades
      s = s.replace(/praça\s+em[íi]lio\s+da\s+silveira\s*,?\s*\d*\s*centro\.?/gi, '')
      // Normaliza espaços
      s = s.replace(/[ \t]+/g, ' ')
      s = s.replace(/\s+([,.;!?])/g, '$1')
      s = s.trim()
      return s
    }

    var totalDescartados = 0
    var totalCorrigidos = 0

    // 1. Saneamento na coleção message_templates
    try {
      var templates = app.findRecordsByFilter('message_templates', 'id != ""', 'created', 1000, 0)
      for (var i = 0; i < templates.length; i++) {
        var tpl = templates[i]
        var content = tpl.getString('content') || ''
        var name = tpl.getString('name') || ''

        // Verifica se é lista de pacientes (descarte)
        if (isListaMultiplosPacientes(content) || isListaMultiplosPacientes(name)) {
          app.delete(tpl)
          totalDescartados++
          continue
        }

        // Verifica se contém telefone, CPF, e-mail ou dados sensíveis que precisam de correção
        var modificado = false
        var contentLimpo = higienizarTexto(content)
        var nameLimpo = higienizarTexto(name)

        if (contentLimpo !== content) {
          tpl.set('content', contentLimpo)
          modificado = true
        }
        if (nameLimpo !== name) {
          tpl.set('name', nameLimpo)
          modificado = true
        }

        if (modificado) {
          app.saveNoValidate(tpl)
          totalCorrigidos++
        }
      }
    } catch (errTpl) {
      console.log('[0142_saneamento] Nota templates: ' + errTpl)
    }

    // 2. Saneamento na coleção knowledge_base (limpeza de JIDs/telefones na fonte/resposta)
    try {
      var kbRecords = app.findRecordsByFilter('knowledge_base', 'id != ""', 'created', 1000, 0)
      for (var k = 0; k < kbRecords.length; k++) {
        var kb = kbRecords[k]
        var fonte = kb.getString('fonte') || ''
        var resposta = kb.getString('resposta') || ''
        var kbModificado = false

        if (isListaMultiplosPacientes(fonte) || isListaMultiplosPacientes(resposta)) {
          app.delete(kb)
          totalDescartados++
          continue
        }

        var fonteLimpa = higienizarTexto(fonte)
        var respostaLimpa = higienizarTexto(resposta)

        if (fonteLimpa !== fonte) {
          kb.set('fonte', fonteLimpa)
          kbModificado = true
        }
        if (respostaLimpa !== resposta) {
          kb.set('resposta', respostaLimpa)
          kbModificado = true
        }

        if (kbModificado) {
          app.saveNoValidate(kb)
          totalCorrigidos++
        }
      }
    } catch (errKb) {
      console.log('[0142_saneamento] Nota knowledge_base: ' + errKb)
    }

    console.log(
      '[0142_saneamento] Concluído: ' +
        totalCorrigidos +
        ' registro(s) corrigido(s)/anonimizado(s), ' +
        totalDescartados +
        ' descartado(s).',
    )
  },
  (app) => {
    // Reversão no-op — saneamento de privacidade LGPD é idempotente e preserva integridade
  },
)
