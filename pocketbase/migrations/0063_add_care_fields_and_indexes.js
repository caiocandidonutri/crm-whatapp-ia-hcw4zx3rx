migrate(
  (app) => {
    var contactsCol = app.findCollectionByNameOrId('crm_contacts')

    if (!contactsCol.fields.getByName('care_status')) {
      contactsCol.fields.add(new TextField({ name: 'care_status', required: false, max: 50 }))
    }

    contactsCol.addIndex('idx_crm_contacts_converted_at', false, 'converted_at', '')
    contactsCol.addIndex('idx_crm_contacts_is_patient', false, 'is_patient', '')
    app.save(contactsCol)

    var msgCol = app.findCollectionByNameOrId('whatsapp_messages')
    msgCol.addIndex('idx_msg_from_me', false, 'from_me', '')
    app.save(msgCol)
  },
  (app) => {
    var contactsCol = app.findCollectionByNameOrId('crm_contacts')
    if (contactsCol.fields.getByName('care_status')) {
      contactsCol.fields.removeByName('care_status')
    }
    contactsCol.removeIndex('idx_crm_contacts_converted_at')
    contactsCol.removeIndex('idx_crm_contacts_is_patient')
    app.save(contactsCol)

    var msgCol = app.findCollectionByNameOrId('whatsapp_messages')
    msgCol.removeIndex('idx_msg_from_me')
    app.save(msgCol)
  },
)
