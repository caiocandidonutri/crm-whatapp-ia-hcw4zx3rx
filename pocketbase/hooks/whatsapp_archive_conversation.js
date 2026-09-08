routerAdd(
  'POST',
  '/backend/v1/whatsapp/archive-conversation',
  (e) => {
    const body = e.requestInfo().body || {}

    if (!body.conversationId) {
      throw new BadRequestError('conversationId is required')
    }

    const conversationId = body.conversationId
    const archived = !!body.archived

    let record
    try {
      record = $app.findRecordById('conversations', conversationId)
    } catch (err) {
      throw new NotFoundError('Conversation not found')
    }

    if (record.getString('user_id') !== e.auth.id) {
      throw new ForbiddenError('Not authorized to access this conversation')
    }

    record.set('archived', archived)
    // Se estiver arquivando ou marcando como lida, zera o contador de não lidas localmente
    if (archived || body.markRead) {
      record.set('unread_count', 0)
    }
    $app.save(record)

    return e.json(200, { success: true, archived: archived })
  },
  $apis.requireAuth(),
)
