/// <reference path="../pb_data/types.d.ts" />

/**
 * REGRA "SIM = TAREFA NO MESMO DIA" (v1 — 05/10/2026)
 * Autorizada pelo Dr. Caio Cândido em 05/10 ("resolver esses pontos").
 *
 * O QUE FAZ: quando um lead/paciente (não cliente, não grupo) envia uma
 * mensagem de AFIRMAÇÃO curta ("sim", "quero", "bora", "vamos marcar"...),
 * cria UMA tarefa interna "FECHAMENTO HOJE: [nome]" com vencimento no
 * MESMO DIA — para a equipe fechar no pico de intenção.
 *
 * O QUE NÃO FAZ: não envia mensagem alguma a ninguém. Só cria tarefa
 * interna (a notificação push existente notif_on_task_create avisa a equipe).
 *
 * Salvaguardas: kill-switch global respeitado; ignora grupos; ignora os
 * números do próprio Caio (canal e pessoal); dedupe por tarefa pendente;
 * gatilho conservador (mensagem curta começando com palavra de afirmação).
 */

onRecordAfterCreateSuccess((e) => {
  try {
    // KILL SWITCH GLOBAL
    try {
      var paused = $app.findFirstRecordByFilter(
        'care_alert_settings',
        'global_automations_paused = true',
      )
      if (paused) return e.next()
    } catch (_) {}

    var msg = e.record
    if (msg.getBool('from_me')) return e.next()

    var jid = msg.getString('remote_jid') || ''
    if (!jid || jid.indexOf('@g.us') !== -1) return e.next() // ignora grupos

    // Números do próprio Dr. Caio (canal e pessoal): nunca geram tarefa
    if (jid.indexOf('5535999288027') !== -1 || jid.indexOf('553599716747') !== -1) {
      return e.next()
    }

    var content = (msg.getString('content') || '').toLowerCase().trim()
    if (!content || content.length > 60) return e.next()

    var triggers = [
      'sim',
      'quero',
      'fechar',
      'fechado',
      'bora',
      'vamos marcar',
      'quero marcar',
      'quero agendar',
      'aceito',
      'combinado',
      'pode marcar',
      'manda',
      'topo',
      'ok vamos',
    ]
    var hit = false
    for (var i = 0; i < triggers.length; i++) {
      if (content === triggers[i] || content.indexOf(triggers[i]) === 0) {
        hit = true
        break
      }
    }
    if (!hit) return e.next()

    var inst = msg.getString('instance_name') || ''
    var contact = null
    try {
      contact = $app.findFirstRecordByFilter('crm_contacts', 'instance_name = {:i} && jid = {:j}', {
        i: inst,
        j: jid,
      })
    } catch (_) {}
    if (!contact) return e.next()

    var stage = contact.getString('stage') || ''
    if (stage === 'cliente') return e.next() // cliente fechado não precisa

    // DEDUPE: já existe tarefa de fechamento pendente/em andamento?
    try {
      var dup = $app.findFirstRecordByFilter(
        'tasks',
        "crm_contact_id = {:cid} && care_category = 'fechamento' && (status = 'pendente' || status = 'em_andamento')",
        { cid: contact.id },
      )
      if (dup) return e.next()
    } catch (_) {}

    var name = contact.getString('contact_name') || contact.getString('push_name') || 'Lead'
    var col = $app.findCollectionByNameOrId('tasks')
    var t = new Record(col)
    t.set('user_id', contact.getString('user_id'))
    var acc = contact.getString('account_id')
    if (acc) t.set('account_id', acc)
    t.set('title', 'FECHAMENTO HOJE: ' + name)
    t.set(
      'description',
      'REGRA SIM=TAREFA: o contato respondeu AFIRMAÇÃO ("' +
        content.substring(0, 40) +
        '") e está no estágio "' +
        stage +
        '" sem fechamento ativo. ' +
        'AÇÃO: confirmar agendamento ou fechar a proposta HOJE, no mesmo dia — o pico de intenção dura horas. ' +
        'Tom: guia da clínica (Manual da Fabiana).',
    )
    t.set('status', 'pendente')
    t.set('priority', 'alta')
    t.set('care_category', 'fechamento')
    t.set('crm_contact_id', contact.id)
    var assigned = contact.getString('assigned_to')
    if (assigned) t.set('assigned_to', assigned)

    // Vencimento: hoje 23:59 horário de Brasília
    var nowSp = new Date(Date.now() - 3 * 3600 * 1000)
    var due = new Date(
      Date.UTC(nowSp.getUTCFullYear(), nowSp.getUTCMonth(), nowSp.getUTCDate(), 23, 59, 0) +
        3 * 3600 * 1000,
    )
    t.set('due_date', due.toISOString())

    $app.save(t)
    $app.logger().info('sim_fechamento_task: created', 'contact', contact.id, 'stage', stage)
  } catch (err) {
    $app.logger().warn('sim_fechamento_task: error', 'error', String(err))
  }
  return e.next()
}, 'whatsapp_messages')
