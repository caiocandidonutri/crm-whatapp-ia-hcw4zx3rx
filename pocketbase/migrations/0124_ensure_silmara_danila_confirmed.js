/// <reference path="../pb_data/types.d.ts" />

migrate(
  (app) => {
    // Restauração de Silmara e Danila para 'confirmado' com limpeza da nota de cancelamento do sync
    // Silmara Lailah Correa (6a7bu3smxmvxnaa)
    // Danila de Oliveira Corrêa (akvf1nu34x2i5lk)
    var targets = ['6a7bu3smxmvxnaa', 'akvf1nu34x2i5lk']
    for (var i = 0; i < targets.length; i++) {
      try {
        var rec = app.findRecordById('appointments', targets[i])
        if (rec) {
          rec.set('status', 'confirmado')
          var oldNotes = rec.getString('notes') || ''
          var cleanNotes = oldNotes
            .replace(/\(Cancelado\/removido na agenda oficial\)/g, '')
            .replace(/Cancelado\/removido na agenda oficial/g, '')
            .trim()
          rec.set('notes', cleanNotes)
          rec.set('updated', new Date().toISOString())
          app.saveNoValidate(rec)
        }
      } catch (err) {
        app.logger().error('migration 0124: erro ao restaurar ' + targets[i] + ': ' + String(err))
      }
    }
  },
  (app) => {},
)
