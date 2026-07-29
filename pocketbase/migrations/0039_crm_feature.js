migrate(
  (app) => {
    const col = app.findCollectionByNameOrId('crm_contacts')
    const comp = app.findCollectionByNameOrId('crm_companies')
    col.fields.add(new RelationField({ name: 'company_id', collectionId: comp.id, maxSelect: 1 }))
    app.save(col)
    col.addIndex('idx_crm_contacts_company_id', false, 'company_id', '')
    app.save(col)
  },
  (app) => {
    const col = app.findCollectionByNameOrId('crm_contacts')
    col.removeIndex('idx_crm_contacts_company_id')
    col.fields.removeByName('company_id')
    app.save(col)
  },
)
