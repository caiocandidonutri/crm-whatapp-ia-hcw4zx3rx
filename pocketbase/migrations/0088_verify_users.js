migrate(
  (app) => {
    // Marcar as contas de usuário da clínica (Admin, Caio Candido, Fabiana) como verified=true
    try {
      app
        .db()
        .newQuery('UPDATE users SET verified = 1 WHERE verified = 0 OR verified IS NULL')
        .execute()
    } catch (err) {
      console.log('[0088_verify_users] Erro ao atualizar usuários para verified=1:', err)
    }
  },
  (app) => {
    // Não revertemos status de verificação de usuários
  },
)
