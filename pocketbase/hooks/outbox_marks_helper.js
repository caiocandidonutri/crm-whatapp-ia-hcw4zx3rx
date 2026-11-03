/**
 * Utilitário compartilhado para registrar marca explícita de saída na tabela outbox_marks.
 * Usado em todos os hooks que enviam mensagens pela Evolution API ANTES de o webhook chegar.
 *
 * @param {core.App} app
 * @param {string} messageId - key.id retornado pela Evolution API
 * @param {'ia'|'automacao'} origin - tipo de origem da mensagem
 */
function recordOutboxMark(app, messageId, origin) {
  if (!app || !messageId) return
  var cleanId = String(messageId).trim()
  if (!cleanId) return
  var cleanOrigin = origin === 'ia' ? 'ia' : 'automacao'

  try {
    var outboxCol = app.findCollectionByNameOrId('outbox_marks')
    var markRec = new Record(outboxCol)
    markRec.set('message_id', cleanId)
    markRec.set('origin', cleanOrigin)
    app.save(markRec)
  } catch (err) {
    try {
      app
        .logger()
        .warn(
          'outbox_mark_save_error',
          'message_id',
          cleanId,
          'origin',
          cleanOrigin,
          'err',
          String(err),
        )
    } catch (_) {}
  }
}

module.exports = {
  recordOutboxMark: recordOutboxMark,
}
