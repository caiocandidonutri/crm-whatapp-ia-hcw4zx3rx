migrate(
  (app) => {
    // Reconciliação one-shot: agendamentos passados 'confirmado' -> 'realizado'
    // Data de corte: momento atual da execução
    const nowIso = new Date().toISOString()
    const note = 'Reconciliado automaticamente — consulta realizada no passado'

    // Busca todos os agendamentos confirmados com ends_at no passado
    // Ou starts_at no passado quando ends_at não estiver preenchido
    const appts = app.findRecordsByFilter(
      'appointments',
      'status = "confirmado" && ((ends_at != "" && ends_at < {:now}) || ((ends_at = "" || ends_at = null) && starts_at < {:now}))',
      'starts_at',
      500,
      0,
      { now: nowIso },
    )

    let reconciledCount = 0

    for (let i = 0; i < appts.length; i++) {
      const rec = appts[i]
      rec.set('status', 'realizado')
      const currentNotes = rec.getString('notes')
      const updatedNotes = currentNotes ? currentNotes + '\n' + note : note
      rec.set('notes', updatedNotes)
      rec.set('last_synced_at', nowIso)
      app.saveNoValidate(rec)
      reconciledCount++
    }

    console.log(
      `[migration 0128] Reconciliados ${reconciledCount} agendamentos passados de 'confirmado' para 'realizado'`,
    )
  },
  (app) => {
    // Revert intencionalmente no-op para preservar auditoria dos atendimentos realizados
  },
)
