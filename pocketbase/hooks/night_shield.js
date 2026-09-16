/// <reference path="../pb_data/types.d.ts" />

/**
 * NIGHT SHIELD — BLINDAGEM NOTURNA DAS 21H ÀS 07H (HORÁRIO DE BRASÍLIA / AMERICA/SAO_PAULO)
 *
 * Garante que nenhuma mensagem automática (lembrete de consulta, confirmação 24h,
 * recall de paciente, pesquisa NPS ou resposta atrasada de IA) seja disparada
 * no meio da noite para pacientes.
 *
 * Como cada arquivo de hook em PocketBase (Goja) executa em escopo isolado ou pode
 * compartilhar rotinas via global, esta função exportada/global fica disponível
 * para validação de segurança adicional.
 */

// Retorna se o momento atual (ou data fornecida) está na faixa das 21:00 às 06:59 de Brasília (UTC-3)
function isNightShieldActive(targetDate) {
  var now = targetDate || new Date()
  var ms = typeof now.getTime === 'function' ? now.getTime() : Date.now()
  // Offset fixo de Brasília: UTC-3 (-3 horas = -10800000 ms)
  var spDate = new Date(ms - 3 * 3600 * 1000)
  var hourSp = spDate.getUTCHours()
  return hourSp >= 21 || hourSp < 7
}

// Se o ambiente suportar escopo global ou exports
if (typeof globalThis !== 'undefined') {
  globalThis.isNightShieldActive = isNightShieldActive
}
