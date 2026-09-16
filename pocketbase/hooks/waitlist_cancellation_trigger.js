// @ts-check
/// <reference path="../pb_data/types.d.ts" />

/**
 * Hook para reagir a cancelamentos de agendamentos e alertar a Fabiana sobre a Lista de Espera.
 * Quando um agendamento é cancelado ou tem status alterado para 'cancelado',
 * busca o primeiro paciente compatível na coleção `waitlist` (aguardando) e cria
 * uma tarefa na Central de Tarefas para a Fabiana agir humanamente.
 */

onRecordUpdate((e) => {
  var newRecord = e.record
  var oldRecord = e.oldRecord

  try {
    var oldStatus = oldRecord ? oldRecord.getString('status') : ''
    var newStatus = newRecord.getString('status')

    // Só reage se o status mudou para 'cancelado'
    if (newStatus === 'cancelado' && oldStatus !== 'cancelado') {
      var accountId = newRecord.getString('account_id')
      var startsAt = newRecord.getString('starts_at')
      var city = newRecord.getString('city') || newRecord.getString('location') || ''

      // Só busca encaixe se a vaga for futura
      var nowIso = new Date().toISOString()
      if (startsAt && startsAt > nowIso) {
        // Formatar data e horário aproximado
        var dateObj = new Date(startsAt)
        var spMs = dateObj.getTime() - 3 * 3600 * 1000
        var spDate = new Date(spMs)
        var dayStr =
          ('0' + spDate.getUTCDate()).slice(-2) + '/' + ('0' + (spDate.getUTCMonth() + 1)).slice(-2)
        var hourStr =
          ('0' + spDate.getUTCHours()).slice(-2) + ':' + ('0' + spDate.getUTCMinutes()).slice(-2)
        var spHour = spDate.getUTCHours()
        var period = spHour < 12 ? 'manha' : 'tarde'

        // Buscar lista de espera aguardando
        var filter = 'status = "aguardando"'
        if (accountId) filter += ' && account_id = "' + accountId + '"'

        var candidates = []
        try {
          candidates = $app.findRecordsByFilter('waitlist', filter, 'created', 20, 0)
        } catch (_) {}

        if (candidates && candidates.length > 0) {
          // Filtrar o candidato mais compatível (mesma cidade ou qualquer, mesmo período ou qualquer)
          var bestCandidate = null
          for (var i = 0; i < candidates.length; i++) {
            var c = candidates[i]
            var cCity = c.getString('cidade_preferida')
            var cPeriod = c.getString('periodo_preferido')

            var matchCity =
              !cCity ||
              cCity === 'Qualquer' ||
              (city && city.toLowerCase().indexOf(cCity.toLowerCase()) !== -1)
            var matchPeriod = !cPeriod || cPeriod === 'qualquer' || cPeriod === period

            if (matchCity && matchPeriod) {
              bestCandidate = c
              break
            }
          }

          // Se não achou exato, pega o mais antigo da fila
          if (!bestCandidate) {
            bestCandidate = candidates[0]
          }

          if (bestCandidate) {
            var candName = bestCandidate.getString('nome')
            var candPhone = bestCandidate.getString('telefone')
            var createdStr = bestCandidate.getString('created')
            var daysWaiting = 1
            if (createdStr) {
              var cDate = new Date(createdStr)
              daysWaiting = Math.max(
                1,
                Math.round((Date.now() - cDate.getTime()) / (24 * 3600 * 1000)),
              )
            }

            var taskTitle =
              'Vaga aberta (' +
              (city || 'Clínica') +
              '): contatar ' +
              candName +
              ' da lista de espera'
            var taskDesc =
              'Uma vaga abriu para ' +
              dayStr +
              ' às ' +
              hourStr +
              ' (' +
              (city || 'presencial') +
              ').\n\n' +
              'Paciente na fila: ' +
              candName +
              '\nTelefone: ' +
              candPhone +
              '\nAguardando há: ' +
              daysWaiting +
              ' dia(s).\n' +
              'Preferência: ' +
              (bestCandidate.getString('tipo_desejado') || 'Consulta') +
              ' (' +
              (bestCandidate.getString('cidade_preferida') || 'Qualquer cidade') +
              ').'

            // Criar a tarefa na Central de Tarefas para a Fabiana
            var tasksCol = $app.findCollectionByNameOrId('crm_tasks')
            var taskRec = new Record(tasksCol)
            if (accountId) taskRec.set('account_id', accountId)
            taskRec.set('title', taskTitle)
            taskRec.set('description', taskDesc)
            taskRec.set('status', 'todo')
            taskRec.set('priority', 'high')
            taskRec.set('care_category', 'geral')
            if (bestCandidate.getString('contact_id')) {
              taskRec.set('contact_id', bestCandidate.getString('contact_id'))
            }
            $app.save(taskRec)

            $app
              .logger()
              .info(
                'waitlist_task_created_on_cancellation',
                'candidate',
                candName,
                'slot',
                startsAt,
              )
          }
        }
      }
    }
  } catch (err) {
    $app.logger().warn('waitlist_cancel_hook_error', 'err', String(err))
  }

  e.next()
}, 'appointments')
