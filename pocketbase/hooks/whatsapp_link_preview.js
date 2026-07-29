// Endpoint de "unfurl" para mensagens com link no texto. Busca a URL
// passada e extrai OG tags (title, description, image) pra renderizar
// um card embedded no front, mesmo quando o Baileys NÃO populou o
// linkPreview no payload original (que é a maioria dos casos).
//
// GET /backend/v1/whatsapp/link-preview?url=https://...
//
// Cache: o front cacheia por URL em memória (sessionStorage) então
// chamadas duplicadas não batem aqui. Backend não cacheia — fetch
// fresh a cada chamada com timeout curto pra evitar travar route.
routerAdd(
  'GET',
  '/backend/v1/whatsapp/link-preview',
  (e) => {
    try {
      const queryUrl = e.requestInfo().query.url
      if (!queryUrl) {
        return e.json(400, { success: false, error: 'url required' })
      }
      if (!/^https?:\/\//i.test(queryUrl)) {
        return e.json(400, { success: false, error: 'invalid url' })
      }

      let res
      try {
        res = $http.send({
          url: queryUrl,
          method: 'GET',
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; ConectadoBot/1.0; +https://conectado.app)',
            Accept: 'text/html,application/xhtml+xml',
          },
          timeout: 8,
        })
      } catch (httpErr) {
        return e.json(200, {
          success: false,
          url: queryUrl,
          title: '',
          description: '',
          image: '',
          error: String(httpErr),
        })
      }

      if (res.statusCode < 200 || res.statusCode >= 400) {
        return e.json(200, {
          success: false,
          url: queryUrl,
          title: '',
          description: '',
          image: '',
        })
      }

      let html = ''
      try {
        html = res.body ? new TextDecoder().decode(res.body) : String(res.body || '')
      } catch (_) {
        html = String(res.body || '')
      }

      // Limita parsing aos primeiros 200KB do HTML — OG tags ficam no
      // <head>, então não precisamos varrer documentos enormes.
      if (html.length > 200000) html = html.substring(0, 200000)

      const ogMatch = (name) => {
        const re = new RegExp(
          '<meta[^>]+(?:property|name)\\s*=\\s*["\']og:' +
            name +
            '["\'][^>]+content\\s*=\\s*["\']([^"\']+)["\']',
          'i',
        )
        const m = html.match(re)
        return m ? m[1] : ''
      }
      const ogMatchReversed = (name) => {
        // Variante onde o `content` aparece ANTES do `property/name`
        const re = new RegExp(
          '<meta[^>]+content\\s*=\\s*["\']([^"\']+)["\'][^>]+(?:property|name)\\s*=\\s*["\']og:' +
            name +
            '["\']',
          'i',
        )
        const m = html.match(re)
        return m ? m[1] : ''
      }
      const metaName = (name) => {
        const re = new RegExp(
          '<meta[^>]+name\\s*=\\s*["\']' + name + '["\'][^>]+content\\s*=\\s*["\']([^"\']+)["\']',
          'i',
        )
        const m = html.match(re)
        return m ? m[1] : ''
      }

      let title = ogMatch('title') || ogMatchReversed('title')
      if (!title) {
        const tm = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
        if (tm) title = tm[1].trim()
      }

      let description =
        ogMatch('description') || ogMatchReversed('description') || metaName('description')

      let image = ogMatch('image') || ogMatchReversed('image')
      // Resolve URL relativa de imagem
      if (image && !/^https?:\/\//i.test(image)) {
        try {
          const base = new URL(queryUrl)
          if (image.startsWith('//')) image = base.protocol + image
          else if (image.startsWith('/')) image = base.origin + image
          else image = base.origin + '/' + image.replace(/^\//, '')
        } catch (_) {}
      }

      // Decode entidades HTML básicas que aparecem em meta tags
      const decodeEntities = (s) =>
        (s || '')
          .replace(/&amp;/g, '&')
          .replace(/&quot;/g, '"')
          .replace(/&#39;/g, "'")
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .trim()

      return e.json(200, {
        success: true,
        url: queryUrl,
        title: decodeEntities(title).substring(0, 200),
        description: decodeEntities(description).substring(0, 400),
        image: decodeEntities(image).substring(0, 500),
      })
    } catch (err) {
      $app.logger().warn('link_preview_fatal', 'error', String(err))
      return e.json(500, { success: false, error: 'internal_error' })
    }
  },
  $apis.requireAuth(),
)
