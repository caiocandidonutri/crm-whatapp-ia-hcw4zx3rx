migrate(
  (app) => {
    const col = app.findCollectionByNameOrId('whatsapp_instances')
    col.fields.add(
      new TextField({
        name: 'qrcode_base64',
        max: 2000000,
      }),
    )
    app.save(col)
  },
  (app) => {
    const col = app.findCollectionByNameOrId('whatsapp_instances')
    col.fields.add(
      new TextField({
        name: 'qrcode_base64',
        max: 100000,
      }),
    )
    app.save(col)
  },
)
