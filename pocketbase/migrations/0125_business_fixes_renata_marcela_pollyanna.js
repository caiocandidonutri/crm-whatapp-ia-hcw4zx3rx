/// <reference path="../pb_data/types.d.ts" />

migrate(
  (app) => {
    // 1. Proteger nome oficial e limpar Renata de Avelar Freire
    // Contato uybejy8d0whzas6 e agendamento 5829bz3bbq8ubb5 -> "Renata de Avelar Freire"
    try {
      var contactRenata = app.findRecordById('crm_contacts', 'uybejy8d0whzas6')
      if (contactRenata) {
        contactRenata.set('contact_name', 'Renata de Avelar Freire')
        contactRenata.set('push_name', 'Renata de Avelar Freire')
        app.saveNoValidate(contactRenata)
      }
    } catch (errContact) {
      app
        .logger()
        .error('migration 0125: erro ao atualizar contato uybejy8d0whzas6: ' + String(errContact))
    }

    try {
      var apptRenata = app.findRecordById('appointments', '5829bz3bbq8ubb5')
      if (apptRenata) {
        apptRenata.set('patient_name', 'Renata de Avelar Freire')
        app.saveNoValidate(apptRenata)
      }
    } catch (errAppt) {
      app
        .logger()
        .error('migration 0125: erro ao atualizar agendamento 5829bz3bbq8ubb5: ' + String(errAppt))
    }

    // Conversa vinculada a Renata (se houver)
    try {
      var convRenata = app.findFirstRecordByFilter('conversations', 'remote_jid ~ "553599965352"')
      if (convRenata) {
        convRenata.set('contact_name', 'Renata de Avelar Freire')
        app.saveNoValidate(convRenata)
      }
    } catch (_) {}

    // 2. Deduplicação ±48h: Cancelar agendamento 77rwrpl1u4thmca em favor do oficial h71z7q97o6kp7ok
    try {
      var apptPollyannaDup = app.findRecordById('appointments', '77rwrpl1u4thmca')
      if (apptPollyannaDup) {
        apptPollyannaDup.set('status', 'cancelado')
        var pNotes = apptPollyannaDup.getString('notes') || ''
        var noteMsg = 'Cancelado em favor do agendamento oficial (deduplicação ±48h)'
        if (pNotes.indexOf(noteMsg) === -1) {
          apptPollyannaDup.set('notes', pNotes ? pNotes + ' - ' + noteMsg : noteMsg)
        }
        app.saveNoValidate(apptPollyannaDup)
      }
    } catch (errDup) {
      app
        .logger()
        .error('migration 0125: erro ao cancelar duplicado 77rwrpl1u4thmca: ' + String(errDup))
    }

    // 3. Restaurar Marcela 07/08: agendamento l4srrnptpazkegq -> status='confirmado' com nota "Restaurado — cancelamento indevido do sync"
    try {
      var apptMarcela = app.findRecordById('appointments', 'l4srrnptpazkegq')
      if (apptMarcela) {
        apptMarcela.set('status', 'confirmado')
        var mNotes = apptMarcela.getString('notes') || ''
        var restoreMsg = 'Restaurado — cancelamento indevido do sync'
        if (mNotes.indexOf(restoreMsg) === -1) {
          apptMarcela.set('notes', mNotes ? mNotes + ' - ' + restoreMsg : restoreMsg)
        }
        app.saveNoValidate(apptMarcela)
      }
    } catch (errMarcela) {
      app
        .logger()
        .error('migration 0125: erro ao restaurar Marcela l4srrnptpazkegq: ' + String(errMarcela))
    }
  },
  (app) => {},
)
