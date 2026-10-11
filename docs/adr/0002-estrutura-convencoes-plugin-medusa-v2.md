# ADR 0002 — Estrutura e convenções do plugin @voolulabs/medusajs-plugin-pos-payments (Medusa v2)

- **Status:** Aceito
- **Data:** 2026-09-25
- **Escopo:** Fase 1 — scaffold e integração do plugin
- **Localização:** migra para `medusajs-plugin-pos-payments/docs/adr/0002-…` junto com o ADR 0001.

## Contexto

As convenções abaixo foram verificadas em quatro fontes complementares (2026-09-25):

1. **Doc oficial Medusa v2** — fundamentals/plugins/create e resources/references/payment/provider
   (incluindo o wrapper `ModuleProvider` e a localização `src/providers` em plugins).
2. **`medusajs/examples/wishlist-plugin`** — plugin canônico citado pela doc (estrutura completa,
   package.json de publicação).
3. **`@narisolutions/medusa-plugin-pos` (clonado neste workspace)** — referência de casa:
   `middlewares.ts` com `export default` + `authenticate("user", ["bearer"])`,
   `getPluginOptions` via `CONFIG_MODULE`, tsconfig `rootDir: "."`, `scripts/fix-aliases.js`.
4. **`store-b2c-boilerplate/backend/medusa-config.js`** — precedente real de **registro duplo**:
   o pacote meilisearch aparece no array `plugins` (rotas/admin) **e** como provider em
   `modules → Search → options.providers`.

## Decisões

1. **Monorepo pnpm** (`medusajs-plugin-pos-payments/`, workspaces), pacote em
   `plugins/pos-payments`, `name: @voolulabs/medusajs-plugin-pos-payments`,
   `keywords: ["medusa-v2", "medusa-plugin-payment", "pos"]`, `files: [".medusa/server"]`.
2. **Exports map** (modelo wishlist-plugin/narisolutions): `.` (entry do plugin),
   `./providers/*` → `.medusa/server/src/providers/*/index.js`, `./package.json`,
   `./*` → `.medusa/server/src/*.js`.
3. **Scripts:** `build` = `medusa plugin:build`; `dev` = `medusa plugin:develop`;
   `prepublishOnly` = `medusa plugin:build`; `typecheck` = `tsc --noEmit`; `test` = `vitest run`.
4. **Versões:** devDeps `@medusajs/{cli,framework,medusa,test-utils}` **`^2.19`** (compila contra a
   versão do backend-alvo) + `@swc/core`, `typescript`, `vitest`; peerDeps
   `@medusajs/framework` + `@medusajs/medusa` **`>=2.15 <3`** (ADR 0006 §5: dropar minor do
   range = MINOR; suportada e quebrada = MAJOR).
5. **Layout de código:**
   - `src/index.ts` — factory do plugin retornando `{ resolve, options }` (padrão narisolutions).
   - `src/api/` — rotas (`route.ts` + `validators.ts` via zod quando útil) e
     `src/api/middlewares.ts` com **`export default`** de `MiddlewaresConfig`. **Rotas
     autenticadas sob `/admin/pos-payments/*`** — cobertas pela auth do core
     (`bearer`/`session`/`api-key` em `framework/src/http/router.ts:503-507`); o plugin
     **não declara authenticate** para elas ([ADR 0005](0005-superficies-api-auth-plugin.md)).
     A rota **pública** (callback OAuth da Fase 2b) fica em **`/pos-payments/*`** — fora do
     matcher global `/pos/*` do plugin narisolutions (`authenticate("user", ["bearer"])`,
     401 sem token); rotas nossas sob `/pos/*` não funcionariam para a UI do Admin: o middleware
     bearer-only do pai corre antes do filho (`RoutesSorter`) e 401-a requisições só de cookie
     (o SDK do dashboard em modo session não envia bearer). **Webhooks não são rota nossa**: a
     rota nativa do core `POST /hooks/payment/pos-terminal_<id>` (**segmento sem `pp_`** — o
     módulo monta `pp_${segmento}` para resolver o provider; pública; 200 imediato; processa
     async via event bus com `rawData` Buffer) despacha para `getWebhookActionAndData`, que
     valida a assinatura dentro do provider — contrato do `paypal-integration` oficial.
   - `src/providers/pos-terminal/` — `index.ts` com
     `export default ModuleProvider(Modules.PAYMENT, { services: [PosTerminalProviderService] })`
     (import de `@medusajs/framework/utils`); `service.ts` com
     `PosTerminalProviderService extends AbstractPaymentProvider<Options>` (10 métodos abstratos —
     ADR 0001); **options chegam no 2º argumento do construtor** `(cradle, config)`.
     **Webhook por adquirente** (decisão 3 do ADR 0001 + specs): MP/SumUp/Stone configuram a rota
     nativa do core no adquirente; **Cielo não tem webhook** (fluxo síncrono + consulta —
     cielo.md §9): `getWebhookActionAndData` devolve `not_supported` e nenhuma URL é configurada.
   - `src/adapters/` — interface comum + um arquivo por adquirente. **Entra na Fase 2, com o
     primeiro adapter real** (decisão da review 2026-09-29: na Fase 1 o modo manual vive
     inline no provider — sem seam sem segundo caso). Padrões de provider
     consolidados (minados no código de `@easypayment/medusa-payment-paypal` e
     `@lambdacurry/medusa-payment-braintree`): taxonomia de erros preservando `MedusaError`
     (`MedusaError.isMedusaError`; recusas da processadora → `PAYMENT_AUTHORIZATION_ERROR`;
     erros desconhecidos re-wrapped — o Medusa mascara não-MedusaError como "unknown error" em
     produção); normalização do `data` da sessão com zod (aliases camel/snake);
     `getPaymentStatus` nunca lança; `static validateOptions` valida e mescla defaults; acesso a
     DB (Fase 2b+) via `pgConnection`/`logger` do cradle, sem DI cross-container; **workflows do
     core via registro global (`MedusaWorkflow`), nunca importando `@medusajs/core-flows`**
     (registro duplicado quebra o boot).
   - `src/utils/plugin-options.ts` — padrão `getPluginOptions` via `CONFIG_MODULE`
     (copiado do narisolutions) para as rotas.
6. **Registro duplo no backend** (obrigatório — as rotas só carregam pelo array `plugins`):
   - `plugins: [{ resolve: "@voolulabs/medusajs-plugin-pos-payments", options: {} }]` → rotas.
   - `modules → @medusajs/payment → options.providers → { resolve: "@voolulabs/medusajs-plugin-pos-payments/providers/pos-terminal", id: "card"|"pix"|"cash"|"mercadopago"|…, options: { acquirer, …credenciais } }`.
7. **Imports relativos, sem aliases `@/`:** elimina a classe de bug que motivou o
   `scripts/fix-aliases.js` do plugin narisolutions (swc não resolve aliases no output instalado).
   Build fica `medusa plugin:build` puro. Se aliases forem adotados no futuro, portar o fix-aliases.
8. **tsconfig (estilo casa):** CommonJS, target ES2021, `strict`, `rootDir: "."` (preserva o
   prefixo `src/` no output `.medusa/server`), `include: ["src"]`, mais
   `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes` + `noImplicitOverride`
   (código de dinheiro — [engenharia.md](../engenharia.md) §2). **Errata (2026-09-30):
   `verbatimModuleSyntax` não entra** — proibido em output CommonJS (TS1287/TS1295, confirmado
   no build real). **Errata (2026-10-02) — lint/format: de "Biome único" para ESLint +
   `@medusajs/eslint-plugin` (preset `recommended`) + Prettier** (PR #33): o plugin oficial
   de lint do Medusa (v2.16+) codifica convenções do framework que o Biome não cobre (rotas,
   middlewares, subscribers, workflows, imports de pacotes internos deprecados) e é o padrão
   da comunidade (docs resources/lint, medusa-starter-plugin); regras de export por tipo de
   arquivo (subscriber/route/jobs) substituem o `noDefaultExport` + overrides do Biome, que
   brigava com os default exports exigidos pelo Medusa. A disciplina de type-only imports
   migra para `consistent-type-imports` (typescript-eslint); acréscimo da casa:
   `no-floating-promises` type-aware em `plugins/pos-payments/src` (código de dinheiro).
   Formatação com o `.prettierrc` do monorepo medusajs/medusa (`semi: false`, aspas duplas).
   Gate na CI logo após o install, `--max-warnings 0`, provado por mutação.
9. **Testes:** vitest unitário para adapters e utilitários, specs colocation
   `__tests__/*.unit.spec.ts`; **HTTP das adquirentes mockado com MSW** interceptando o serviço
   real (padrão paystack — inclui teste de assinatura de webhook e de retry); um suite
   `integration-tests/http` com `medusaIntegrationTestRunner({ inApp: true })` de
   `@medusajs/test-utils` (não depende de migrations —
   estado da cobrança vive em `payment.metadata`). **Contrato de dados de sessão tipado**: schema
   zod exportado via `./types` (padrão gorga/paystack), normalizando camel/snake — medusa faz
   merge/replay do `data` do cliente em `initiatePayment`, então dados sensíveis de um toque são
   removidos antes de persistir. Sem `src/workflows`,
   `src/subscribers`, `src/jobs`, `src/links` no v1. **`src/admin` entra na Fase 2b** — o
   onboarding do lojista vive no Admin (plano §7.1 · [ui-ux-admin.md](../ui-ux-admin.md) §3):
   `src/admin/widgets/` + `src/admin/routes/` com `defineWidgetConfig`/`defineRouteConfig` de
   `@medusajs/admin-sdk`, ids de widget prefixados `pos-payments:*`, componentes `@medusajs/ui`
   (internals do `@medusajs/dashboard` indisponíveis no alvo 2.19 —
   [ADR 0004](0004-onboarding-ui-admin.md)); escopo mínimo: rota `settings/pos-payments` +
   widget `order.details`.
   Modelos próprios (Fase 2b): `src/modules/<nome>` com models + migrations MikroORM
   timestampadas (`connection`, `credential`, `oauth_state`, `audit_event` —
   ADR 0004); migrations de plugin executam via **`medusa
   db:migrate` explícito** (não rodam no `start`/`develop` — verificado no fonte v2.19.0).
10. **Fluxo de desenvolvimento:** backend de dev (WSL) consome via **symlink** do pacote em
    `node_modules` + **cópia pós-build para `.medusa/server`** (plano §6.4 — `file:` externo
    quebra o postBuild; errata 2026-09-30); a cada mudança, `medusa plugin:build` + restart;
    alternativa em watch: `medusa plugin:develop`. Publicação ([ADR 0006](0006-branching-e-versionamento.md)):
    `prepublishOnly` garante build; tag `v*` na `main` dispara o workflow com **provenance**
    (`id-token: write`) e **guards** — tag ancestral de `main`, tag = `package.json` version,
    dist-tag `next`/`latest` derivado da versão. Os guards tornam o publish idempotente (tag é
    única por versão), dispensando a comparação com `npm view`.

## Consequências

- **Positivas:** convenções idênticas às do ecossistema (wishlist-plugin/narisolutions) → qualquer
  dev Medusa reconhece o layout; registro duplo evita a surpresa "provider carrega mas rotas não";
  ausência de aliases remove pós-processamento de build.
- **Custos aceitos:** imports relativos em imports profundos; symlink + cópia pós-build no dev
  loop (watch opcional disponível).
- **Reversibilidade:** nenhum lock-in — a estrutura é a padrão; mover para `src/provider` singular
  (convenção de scaffold mais recente) seria rename + ajuste no exports map.

## Reuso do ecossistema (v2.19) — o que o core já entrega, o que não inventamos

> Princípio: **nenhuma tabela nova no v1/v2; nenhuma superfície que o core ou um plugin
> consolidado já entregue**. Verificado no fonte v2.19.0 (`.cache-deep2/medusa-reuse/`) e no
> registry npm (2026-09-27).

- **Estado da cobrança sem tabela nossa**: `PaymentSession.data/context/metadata` e
  `Payment.data/metadata` são JSONB (`packages/modules/payment/src/models/*`) — estado do
  charge, ids do adquirente e o mapa `MerchantOrderId`-N15 ⇄ session id vivem aí. **Zero
  migrations na Fase 1/2.** Duas precisões da revisão adversarial (2026-09-27): (a) o provider
  só persiste pelo `data` que devolve — o **mapa N15 ⇄ session é escrito pelo serviço/rota do
  plugin** via `paymentModule.updatePayment` (path confirmado no fonte, `payment-module.ts:692`,
  que aceita `metadata`); (b) os filtros padrão do módulo **não consultam campos JSONB** — o
  desenho nunca pode depender de "achar session por MerchantOrderId": nossas rotas sempre
  carregam o session id de origem (e a Cielo, único caso N15, não tem webhook — a consulta
  parte do caixa, com contexto).
- **Estorno**: `Refund` + `RefundReason` são entidades de primeira classe (translatable, com
  metadata) — o fluxo de refund usa os workflows do core; o adapter só repassa à adquirente.
- **Webhook**: rota global `POST /hooks/payment/:provider` + event bus (5 s / 3 tentativas) —
  nada a construir (ver Evidências).
- **Idempotência/lock distribuído**: `Modules.LOCKING` existe no v2.19
  (`modules-sdk/definition.ts:29`) com **default in-process** (`@medusajs/medusa/locking`) e
  variante redis (`locking-redis`) via config — mesmo padrão condicional a `REDIS_URL` do event
  bus. Serializa criação de cobrança em vez de tabela de lock própria; a base continua sendo
  chave estável + idempotência do adquirente.
- **Validação de request**: `defineMiddlewares` + `validateAndTransformQuery/Body` (zod) do
  framework — uso real confirmado no `rokmohar/medusa-plugin-meilisearch` — em vez de parsing
  manual (alinha com engenharia.md §1.5).
- **Erros, logs, dinheiro**: `MedusaError`, `ContainerRegistrationKeys.LOGGER`, `MathBN` —
  já padrão deste doc/engenharia.md §6.
- **Fluxos do core (`@medusajs/core-flows`)**: criação de session, authorize, capture, refund
  e `markPaymentCollectionAsPaid` — o plugin **reusa** os workflows; a máquina `ChargeStatus`
  (engenharia.md §1.2) governa só a camada do adapter.
- **Admin UI**: extensões (widgets/routes) do plugin — padrão do ecossistema, ADR 0004.
- **Catálogo/barcode**: já servido por `@narisolutions/medusa-plugin-pos` (`/pos/products`,
  `/pos/product-by-barcode`) — **não sobrepor**; plugin novo usa só `/pos/payments/*`.
  Busca pesada opcional: meilisearch já presente no backend store-b2c.
- **SDK do app de caixa**: `@medusajs/js-sdk` admin (`payment`, `payment-collection`) já cobre
  o consumo — nenhum SDK novo.
- **Credenciais por merchant (Fase 2b) — o único ponto de persistência nova**: não há
  substituto core (módulo `settings` = views de UI do admin, não key-value; módulo `api-key` =
  chaves de API; `store.metadata` proibido pela regra de segredos). Decisão: enquanto houver
  um único backend/merchant, credenciais em **env**; ao abrir multi-merchant, seguir o padrão
  consolidado do ecossistema — **migration empacotada no próprio plugin**, aplicada
  explicitamente (`medusa db:migrate`, nunca automática — guarda do plano §10).
- **Nicho vazio no ecossistema (2026-09-27)**: nenhum plugin consolidado de card-present/
  terminal Cloud para Medusa (registro npm). Adjacentes mapeados, **sem adoção**: `medusa-pos-plugin`
  v0.0.13 (draft-cart + Razorpay UPI, Índia; peerDeps em 2.12 antigo — sem conflito de rota com
  `/pos/payments/*`), `medusa-payment-manual` (precedente do provider manual da Fase 1),
  `@pradip1995/pos-common` (utilitários Expo de impressora térmica — app-side, não se aplica
  ao Tauri), `sumup/sumup-plugin-medusa` (online-only — coexiste, sumup.md §13).

## Evidências de implementação (re-verificadas no fonte e em plugins reais, 2026-09-27)

- **Core v2.19.0** (`.cache-medusa-src/`): rota global de webhook `POST /hooks/payment/:provider`
  com `preserveRawBody` que emite `PaymentWebhookEvents.WebhookReceived` no event bus
  (delay `webhook_delay` default 5 s, `webhook_retries` default 3) e responde 200 —
  `packages/medusa/src/api/hooks/payment/[provider]/route.ts` + `api/hooks/middlewares.ts`;
  `AbstractPaymentProvider` em `packages/core/utils/src/payment/abstract-payment-provider.ts`
  (`public static identifier` + **10 métodos abstratos** sem default: initiate/authorize/
  capture/refund/cancel/delete/retrieve/update/getPaymentStatus/getWebhookActionAndData);
  loader de middlewares **exige default export** de `defineMiddlewares`
  (`middleware-file-loader.ts:58-69` — "Invalid default export found…"); `authenticate(actorType,
  authTypes)` — assinatura `authenticate("user", ["bearer"])` confirmada no spec do
  `authenticate-middleware.ts`.
- **Plugin oficial SumUp↔Medusa** (`sumup/sumup-plugin-medusa`): provider
  `class SumUpPaymentProviderService extends AbstractPaymentProvider<Options>` com
  `constructor(container, options)`; `getWebhookActionAndData` retorna
  `{action, data: {session_id, amount}}` e usa `input.context.idempotency_key`;
  `package.json`: `exports` `['./package.json', './providers/*', './*']`, peerDep
  `@medusajs/framework ^2.15.5`, build `medusa plugin:build`.
- **Plugin de terceiros em produção** (`rokmohar/medusa-plugin-meilisearch`, em uso no backend
  store-b2c): `src/api/middlewares.ts` com `defineMiddlewares` + `authenticate` importados de
  `@medusajs/framework` e subpath `./providers/*` no exports.

## Referências

- Doc oficial: [plugins/create](https://docs.medusajs.com/learn/fundamentals/plugins/create) ·
  [payment provider](https://docs.medusajs.com/resources/references/payment/provider)
- `medusajs/examples/wishlist-plugin` — package.json (exports, scripts, devDeps pinados) e árvore
  `src/{api,modules,links,workflows,jobs,subscribers,admin}`
- Referências consolidadas mineradas no código (2026-09): `@easypayment/medusa-payment-paypal`
  (money gates, webhook pipeline, idempotência com montante, circuit breaker) ·
  `lambda-curry/medusa-plugins` (monorepo turbo + publish idempotente + braintree 3DS) ·
  `@rsc-labs/medusa-store-analytics-v2` (admin UI em plugin) — detalhes no plano e em
  [ui-ux-admin.md](../ui-ux-admin.md) §3
- `medusa-plugins/plugins/medusa-plugin-pos` (local) — `src/api/middlewares.ts`,
  `src/utils/plugin-options.ts`, `tsconfig.json`, `scripts/fix-aliases.js`
- `store-b2c-boilerplate/backend/medusa-config.js` — registro duplo (plugin + provider) do meilisearch

## Erratas 2026-10-01 (review adversarial do workspace)

1. **peerDependencies**: o pacote 0.0.1 declara **três** peers — `@medusajs/framework`,
   `@medusajs/medusa` e **`@medusajs/utils`**, todos `>=2.15 <3` (helpers importados em runtime,
   ex. `ContainerRegistrationKeys` em `src/utils/plugin-options.ts`). Superfície semver do
   contrato de 1.0.0 (ADR 0006 §4) — este §4 fica atualizado por esta errata.
2. **Adapters = diretório por adquirente** (`src/adapters/<acquirer>/{client,types,validation,…}`
   + `types.ts` da interface comum em `src/adapters/`), functional core/imperative shell
   (engenharia.md §1.4–§1.5), budget ≤100 linhas/arquivo (opcore) — não "um arquivo por
   adquirente" (§5).
3. **Subscribers entram na Fase 2** para reconciliação de refund/cancel originados no terminal
   (`refundPaymentWorkflow`, nunca serviço do módulo — event-bus.md §2.3; ADR 0007 em preparo).
   O §9 passa a valer a workflows/subscribers de negócio próprios; jobs/links continuam fora.
   *(Nota 2026-10-07: a parte de "jobs fora" foi revogada pela errata 6 de 2026-10-07 —
   `src/jobs/` existe desde a Onda 2; links continuam fora.)*
4. **`middlewares.ts` é condicional** (nasce com o primeiro validador/rate-limit próprio —
   ADR 0005); na Fase 1 o arquivo não existe e a auth é toda do core.
5. **`module`/`moduleResolution: node16`** no tsconfig (necessário para resolver o exports map
   do `@medusajs/framework` no typecheck); `verbatimModuleSyntax` continua fora
   (errata 2026-09-30).

## Erratas 2026-10-07 (Onda 2 — conciliação periódica)

6. **Jobs entram** — a errata 3 de 2026-10-01 deixava "jobs/links fora"; o job agendado
   `pos-payments-reconcile` (`src/jobs/`, cron diário — A7 do diagnóstico de 2026-10-05)
   elimina a aresta "refund de terminal perdido após esgotar o event bus" DENTRO da
   janela de 30 dias do job (refund na MP vale até 90 dias para cartão físico — o
   resíduo 31–90d segue dependendo do reenvio do MP; janela configurável fica para o
   backlog) e reutiliza a decisão do subscriber (ADR 0007). Links continuam fora. Acesso a
   dados no job: **graph sobre a entidade `payment`** — é o blob `payment.data` que
   recebe as transições do charge gravadas por capture/refund do provider (a sessão
   fica com o blob do authorize — blob do initiate + `authorized_at` — e nunca
   recebe as transições do charge), com filtro de COLUNA `provider_id` + janela
   temporal em `captured_at` (OperatorMap, types 2.19); o recorte JSONB
   (`data.state`) é em memória (filtros padrão não consultam JSONB — regra §Reuso). Nota de verificação:
   `payment_session` É alias válido do graph no 2.19 (o `defineJoinerConfig` auto-carrega
   os models e computa aliases; prova de produção: `processPaymentWorkflow` do core-flows
   consulta `entity: "payment_session"`) — uma versão anterior desta errata afirmava o
   contrário, com verificação incompleta do joiner-config.
