# Guia para agentes neste repositório

Este repositório roda numa plataforma híbrida: **Skip** (no-code/AI builder) +
**git** (GitHub) + **PocketBase** (backend self-hosted pelo Skip). Esse arranjo
tem armadilhas específicas que valem ser documentadas — agente que ignorar
isso vai ter dor.

## Stack

- **Front:** React + Vite + TypeScript + shadcn/ui + Tailwind. Entrada em
  `src/main.tsx`, rotas em `src/App.tsx`.
- **Backend:** PocketBase JSVM (Goja). Hooks em `pocketbase/hooks/*.js`,
  migrations em `pocketbase/migrations/*.js` (numeradas em sequência).
- **Integração externa:** Evolution API (WhatsApp Baileys) chamada via
  `$http.send` dos hooks.
- **Plataforma:** o Skip Cloud roda o PocketBase, gerencia sync com GitHub e
  faz publish/build do front.

## Fluxo dual: Skip ↔ GitHub

O Skip mantém **uma cópia do filesystem** no servidor dele. A cada operação,
faz auto-commit e tenta sincronizar com o GitHub:

```
Skip server filesystem  ⇄  GitHub repo  ⇄  Local dev (clone do GitHub)
```

Quando você (agente) faz push pro GitHub a partir do clone local, o Skip vai
puxar essa mudança no próximo sync — desde que o sync esteja rolando bem.

### Etapas internas do auto-sync do Skip

Identificadas pelos commits que aparecem no `git log` do remoto:

1. `Auto-commit before sync` — Skip salva o estado local antes de puxar.
2. `git pull` — pega do GitHub.
3. `Restore protected files` — restaura arquivos listados em
   `.skip.config.json#preventAI` (lock files, configs, etc).
4. `Auto-commit after sync` — finaliza.
5. `git push` — manda mudanças locais pro GitHub.

Cada etapa é um ponto de falha conhecido (ver "Erros recorrentes" abaixo).

## `.skip.config.json` — guardrails da plataforma

Arquivo crítico, gerenciado pelo Skip. Não modificar a mão.

```json
{
  "preventAI": [
    "**/*.{png,jpg,jpeg,gif,svg,ico,webp}",
    "**/*.d.ts",
    ".skip.config.json",
    ".env*",
    "package.json",
    "pnpm-lock.yaml",
    "bun.lockb",
    "tsconfig.*.json",
    "vite.config.ts",
    "postcss.config.js"
  ],
  "deployment": {
    "lastDevBuildRef": "<sha>",
    "lastProdBuildRef": "<sha>",
    "lastPublishedRef": "<sha>"
  }
}
```

**`preventAI`** lista arquivos que o Skip NÃO modifica via prompt do chat. Quando
o usuário pede no Skip "atualize a versão do package.json", o Skip recusa
porque está em `preventAI`. Pra editar esses arquivos, **commit local + push**
direto pelo git. O Skip puxa via sync.

**`deployment.lastProdBuildRef`** indica o commit publicado em produção. O
Skip só atualiza esse ref quando o usuário clica "Publicar" no painel.

**`excludeFromContext`** lista arquivos que o Skip NÃO carrega no contexto da
IA dele (componentes UI, tests). Economia de tokens no chat dele.

## Erros recorrentes e como tratar

### 1. `nothing to commit, working tree clean`

```
Server error: Failed to pull from remote: ... git commit -m 'Restore protected files' On branch main nothing to commit, working tree clean
```

Bug no script do Skip — etapa 3 espera ter algo pra commitar, e quando os
arquivos protegidos não diferem entre local e remoto, o git devolve exit
code 1 ("nothing to commit") e o Skip propaga como falha.

**Workaround:** bumpar a versão de `package.json` localmente e push. Dá ao
Skip "algo pra processar" no próximo sync. Já fizemos isso várias vezes:

```bash
# Editar package.json: "version": "X.Y.Z" → "X.Y.(Z+1)"
git commit -am "chore: bump version 0.0.X → 0.0.Y"
git push origin main
```

### 2. `File X exceeds 100MB`

```
remote: error: GH001: Large files detected.
remote: error: File core.15 is 3602.83 MB
```

Core dumps do Linux (`core.X`) gerados quando o PocketBase do Skip crasha.
Ficam no working dir do servidor Skip. O auto-commit do Skip pega via
`git add -A` e GitHub rejeita o push.

**`.gitignore` cobre o caso futuro:**

```
core
core.*
*.core
*.dmp
*.dump
pb_data/
pb_data.zip
pb_logs/
pocketbase/pb_data/
pocketbase/pb_logs/
pocketbase/backups/
pocketbase/*.db
pocketbase/*.db-*
```

**Mas se o arquivo já foi trackeado:** `.gitignore` só vale pra arquivos NÃO
trackados. Pra arquivo já no índice do Skip, precisa `git rm --cached` no
servidor — coisa que o agente local NÃO consegue fazer remotamente. Caminhos
nesse caso:

- **Suporte Skip:** abrir ticket pedindo `git rm --cached core.* && git push --force` no servidor deles.
- **Reset workspace pelo painel Skip:** se o painel oferecer opção tipo
  "Reset workspace from GitHub", clicar — descarta o estado podre do servidor
  Skip e re-clona limpo do GitHub.
- **Recriar projeto Skip:** último recurso, criar projeto novo no Skip
  importando do GitHub atual.

### 3. `rejected (non-fast-forward)`

Skip e GitHub divergiram (ambos commitaram em paralelo). Se você fez push
local e o Skip também tinha auto-commit pendente, fica fora de sincronia.

**Workaround:** `git pull --rebase origin main` localmente, resolver
conflitos se houver, depois push. Padrão git normal. Cuidado: às vezes os
auto-commits do Skip são "duplicatas com hash diferente" do mesmo conteúdo
que você fez — nesse caso o rebase pode reaplicar mudanças que já existem.

## Checklist antes de fazer mudanças grandes

- [ ] Verifica `.gitignore` cobre arquivos que podem aparecer (core dumps, dumps
      de banco, logs).
- [ ] Se vai criar migration nova: número sequencial (próximo após o último
      em `pocketbase/migrations/`). Não pula números.
- [ ] Migrations nomeadas: `00XX_descricao_em_snake_case.js`.
- [ ] Hooks nomeados por escopo: `whatsapp_*` pra endpoints do WhatsApp,
      `crm_*` pra CRM, `cron_*` pra cron jobs.
- [ ] Mudanças em arquivos de `preventAI` (`package.json`, configs) só fazem
      sentido por commit local + push. Skip não vai aceitar via prompt.

## Padrões recorrentes no código

### Hook PocketBase com endpoint

```js
routerAdd(
  'POST',
  '/backend/v1/whatsapp/algum-endpoint',
  (e) => {
    try {
      const body = e.requestInfo().body || {}
      // ... validação ...
      const userId = e.auth?.id
      if (!userId) return e.json(401, { success: false, error: 'unauthorized' })
      // ... lógica ...
      return e.json(200, { success: true })
    } catch (err) {
      $app.logger().error('endpoint_error', 'error', String(err))
      return e.json(500, { success: false, error: 'internal_error' })
    }
  },
  $apis.requireAuth(),
)
```

### Migration adicionando campo

```js
migrate(
  (app) => {
    const col = app.findCollectionByNameOrId('conversations')
    if (!col.fields.getByName('archived')) {
      col.fields.add(new BoolField({ name: 'archived' }))
      app.save(col)
    }
  },
  (app) => {
    const col = app.findCollectionByNameOrId('conversations')
    if (col.fields.getByName('archived')) {
      col.fields.removeByName('archived')
      app.save(col)
    }
  },
)
```

Sempre incluir o reverso (down). PocketBase usa pra reverter se necessário.

### Realtime no front (PocketBase)

```ts
useRealtime<Conversation>('conversations', (e) => {
  if (!user || !instanceName) return
  // ... aplica patch ...
})
```

Hook custom em `src/hooks/use-realtime.ts`. Padronizar pra que coalesce
realtime durante import histórico não exploda o front.

## Modelo mental: pra não brigar com o Skip

- Pense no Skip como um **deploy target** + **co-piloto opcional**.
- Faça mudanças via **git local + push** sempre que o agente aqui (Claude
  via CLI) for capaz de fazer. É mais previsível que o agente do Skip.
- Use o agente do Skip pra **publicar** (botão Publicar) e pra mexer em
  coisas que requerem ambiente live (banco, processos rodando).
- Quando o Skip "se confunde" (auto-sync falha), normalmente:
  1. Tenta de novo (às vezes resolve)
  2. Bumpa versão e push (workaround do "nothing to commit")
  3. Reset workspace pelo painel (se oferecer)
  4. Suporte Skip
- **Nunca** force-push pra `main` sem entender o que está sobrescrevendo —
  pode descartar auto-commits do Skip que tinham mudanças importantes.
