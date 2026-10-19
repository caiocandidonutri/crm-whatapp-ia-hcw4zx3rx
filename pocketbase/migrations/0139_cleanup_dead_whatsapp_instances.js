migrate(
  (app) => {
    // 5) Limpeza segura: marcar como inativas/desconectadas as instâncias mortas em status qrcode
    // (apenas registros legados; a instância ativa conectada 'z2inrjevxsg9nvh' NUNCA é tocada).
    // Além disso, limpar/neutralizar qrcode_base64 dessas instâncias para liberar espaço em banco.

    const activeInstanceName = 'instance_1786021758855'
    const activeInstanceId = 'z2inrjevxsg9nvh'

    let deadInstances = []
    try {
      deadInstances = app.findRecordsByFilter(
        'whatsapp_instances',
        'status = "qrcode" && id != {:activeId} && instance_name != {:activeName}',
        'created',
        200,
        0,
        { activeId: activeInstanceId, activeName: activeInstanceName },
      )
    } catch (e) {
      console.log('[0139] Erro ao buscar instâncias mortas: ' + e)
    }

    let markedCount = 0
    for (let i = 0; i < deadInstances.length; i++) {
      const inst = deadInstances[i]
      // SALVAGUARDA ABSOLUTA: se por qualquer razão a instância for a conectada ou tiver status connected, NUNCA toca
      if (inst.id === activeInstanceId || inst.getString('status') === 'connected') {
        continue
      }

      inst.set('status', 'disconnected')
      inst.set('qrcode_base64', '')
      app.saveNoValidate(inst)
      markedCount++
    }
    console.log('[0139] Instâncias mortas marcadas como disconnected: ' + markedCount)

    // Contas de teste duplicadas:
    // Temos contas no sistema. "Conta de Admin" (gkgipckj94jqbqw) criada no início, "Conta de Fabiana" (sl990rm8wahhspv),
    // e a conta oficial da clínica "Conta de Caio Candido" (u2cbx6yw2gm0ook).
    // Por segurança e conforme instrução: "em caso de dúvida, não tocar", não deletamos contas de usuários reais.
    // Apenas identificamos se há contas com nome contendo explicitamente 'teste' / 'duplicada' e sem nenhum vínculo.
    try {
      const testAccounts = app.findRecordsByFilter(
        'accounts',
        'name ~ "teste" || name ~ "Teste" || name ~ "duplicada"',
        'created',
        50,
        0,
      )
      for (let t = 0; t < testAccounts.length; t++) {
        const tAcc = testAccounts[t]
        // Se não for a conta oficial do Caio
        if (tAcc.id !== 'u2cbx6yw2gm0ook') {
          console.log(
            '[0139] Conta de teste identificada: ' + tAcc.id + ' (' + tAcc.getString('name') + ')',
          )
        }
      }
    } catch (_) {}
  },
  (app) => {
    // Reversão no-op
  },
)
