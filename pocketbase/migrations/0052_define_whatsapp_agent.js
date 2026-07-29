/// <reference path="../pb_data/types.d.ts" />
migrate(
  (app) => {
    $ai.agents.define(app, {
      slug: 'whatsapp-manager',
      name: 'Assistente de Atendimento',
      description: 'Atende leads e gerencia o CRM.',
      systemPrompt:
        'Você é um assistente de atendimento inteligente no WhatsApp.\nSiga as instruções de persona que o usuário fornecer em cada mensagem.\nVocê tem acesso a ferramentas para gerenciar tarefas (tasks), contatos (crm_contacts), empresas (crm_companies), conversas (conversations) e mensagens (whatsapp_messages).\nUse essas ferramentas para auxiliar o usuário.\nSempre mantenha a conversa no contexto e seja prestativo.',
      tier: 'fast',
      tools: [
        {
          collection: 'crm_contacts',
          perms: { list: true, read: true, create: true, update: true },
        },
        {
          collection: 'crm_companies',
          perms: { list: true, read: true, create: true, update: true },
        },
        { collection: 'tasks', perms: { list: true, read: true, create: true, update: true } },
        { collection: 'conversations', perms: { list: true, read: true, update: true } },
        { collection: 'whatsapp_messages', perms: { list: true, read: true } },
      ],
    })
  },
  (app) => {
    $ai.agents.delete(app, 'whatsapp-manager')
  },
)
