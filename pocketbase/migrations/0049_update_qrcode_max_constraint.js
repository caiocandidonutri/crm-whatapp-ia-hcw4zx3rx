migrate(
  (app) => {
    const col = app.findCollectionByNameOrId('whatsapp_instances')
    const field = col.fields.getByName('qrcode_base64')
    if (field) {
      col.fields.add(
        new TextField({
          name: 'qrcode_base64',
          max: 2000000,
        }),
      )
      app.save(col)
    }
  },
  (app) => {
    const col = app.findCollectionByNameOrId('whatsapp_instances')
    const field = col.fields.getByName('qrcode_base64')
    if (field) {
      col.fields.add(
        new TextField({
          name: 'qrcode_base64',
          max: 5000,
        }),
      )
      app.save(col)
    }
  },
)
