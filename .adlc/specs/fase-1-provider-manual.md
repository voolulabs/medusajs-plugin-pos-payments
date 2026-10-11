# Spec: Fase 1 — provider pos-terminal manual

> **Registro histórico** — Fase 1 implementada e embarcada na 0.0.1 (deploy 2026-09-29).
> Este spec é o registro do ciclo concluído, não documento vivo: o spec ativo de cada ticket
> novo vive em `.adlc/specs/` (ex.: `fase-2-t1-mp-orders-client.md`). ACs ticados em
> 2026-10-03 com as verificações do deploy da Fase 1 (E2E `scripts/e2e-pos.mjs` contra o
> backend 2.19 real + CI verde — 16/16 testes). Isso encerra o "reconfirmar contra o
> backend 2.19" desta seção.

> **Erratas 2026-10-03 (auditoria spec × código):** (a) o layout da Fase 1 NÃO tem
> `middlewares.ts` — auth 100% do core, sem arquivo do plugin; (b) `initiatePayment`
> manual devolve `{ id: randomUUID(), data: {} }`; (c) não há merge de defaults no
> construtor; (d) o estado do charge vive no `data` da payment session (não em
> `payment.metadata`) — ver T3/CONSTRAINTS 6; (e) §6.3 é contrato futuro (T4+): hoje
> só existe `GET /admin/pos-payments/health`.
> Layout §6.1: `src/types` (contrato público) e `src/admin` (stub exigido pelo build)
> entram no inventário.

Extraído para os gates ADLC.

## 6. Fase 1 — Plugin @voolulabs com provider genérico (sem adquirente)

### 6.1 Estrutura e convenções (detalhadas no [ADR 0002](../../docs/adr/0002-estrutura-convencoes-plugin-medusa-v2.md))

- Monorepo **pnpm** (`medusajs-plugin-pos-payments/`, workspaces), pacote `plugins/pos-payments` com
  `name: @voolulabs/medusajs-plugin-pos-payments`; `files: [".medusa/server"]`; exports: `.` (entry do
  plugin), `./providers/*` → `.medusa/server/src/providers/*/index.js`, `./package.json`,
  `./*` → `.medusa/server/src/*.js`.
- Scripts: `build` = `medusa plugin:build` (sem pós-processamento — **imports relativos, sem
  aliases `@/`**), `dev` = `medusa plugin:develop`, `prepublishOnly` = `medusa plugin:build`,
  `typecheck`, `test` (vitest).
- devDeps `@medusajs/{cli,framework,medusa,test-utils}` **`^2.19`** + `@swc/core` + TypeScript;
  peerDeps `@medusajs/framework` + `@medusajs/medusa` `>=2.15`.
- Layout: `src/index.ts` (factory), `src/api/` (rotas + `middlewares.ts` `export default` —
  rotas autenticadas sob `/admin/pos-payments/*` cobertas pela auth do core, **sem
  authenticate próprio**; a rota pública de callback OAuth usa o namespace
  `/pos-payments/*` — §2.1/[ADR 0005](../../docs/adr/0005-superficies-api-auth-plugin.md); **webhooks são
  da rota NATIVA do core**),
  `src/providers/pos-terminal/` (`index.ts` com `ModuleProvider(Modules.PAYMENT, { services })`,
  `service.ts` com o `AbstractPaymentProvider` — options no 2º argumento do construtor,
  padrão do [paypal-integration](https://github.com/medusajs/examples) oficial),
  `src/adapters/` (**Fase 2** — entra com o primeiro adapter real; na Fase 1 o modo manual
  vive inline no provider, decisão da review 2026-09-29: sem seam sem segundo caso —
  evitar Speculative Generality), `src/utils/plugin-options.ts` (padrão `getPluginOptions` via
  `CONFIG_MODULE` — uso restrito a opções de rota, como o rate limit; as opções de provider
  são as do construtor).
- tsconfig estilo casa: CommonJS, ES2021, strict, `rootDir: "."`, `include: ["src"]`.

### 6.2 Provider `pos-terminal`

- `src/providers/pos-terminal/service.ts`:
  `class PosTerminalProviderService extends AbstractPaymentProvider<PosTerminalOptions>` com
  `static identifier = "pos-terminal"` e `static validateOptions` (falha rápida no boot com
  `MedusaError(INVALID_DATA)`; defaults mesclados no construtor — padrão do paypal-integration
  oficial). **Obrigatório implementar os 10 métodos abstratos** (nenhum tem default — verificado no clone 2.21.1):
  - `initiatePayment` → no-op, retorna `{ data: {} }` (modo manual);
  - `authorizePayment` → `{ data, status: "authorized" }`;
  - `capturePayment` → sucesso local (dinheiro já recebido no terminal);
  - `refundPayment` → registra no `data` (adapter pode repassar à adquirente no futuro);
  - `cancelPayment` → sucesso local;
  - `deletePayment` → `{}` ;
  - `getPaymentStatus` → mapeia `data` para `authorized|captured|canceled|pending` — **nunca
    lança** (erro degrada para `pending`, padrão do paypal-integration);
  - `retrievePayment` / `updatePayment` → eco do `data`;
  - `getWebhookActionAndData` → `{ action: "not_supported" }` na Fase 1; a partir da Fase 2,
    contrato oficial: recebe `{ data, rawData, headers }` (raw body disponível para validar
    assinatura HMAC **dentro** do provider), re-consulta o adquirente e retorna
    `{ action, data: { session_id, amount } }` — `not_supported`/`failed` sem lançar.
- Erros remotos: `MedusaError(UNEXPECTED_STATE)` com a mensagem upstream embutida (padrão do
  paypal-integration); estado persistente do provider no `data` (ids do gateway).
- **Contrato do módulo payment com o provider (verificado no fonte — clone develop 2.21.1; reconfirmar contra o backend 2.19 exato na Fase 1)**: o módulo
  **substitui** o `data` persistido pelo valor retornado pelo método — **todo método devolve o
  blob completo** que deve sobreviver (devolver `{}` clobberiza estado); `initiatePayment` roda
  na criação da session (merge com o `data` de entrada); **`authorizePayment` não é automático** —
  roda no **markAsPaid** (workflow `markPaymentCollectionAsPaid`: cria session →
  `authorizePaymentSessionStep` → `capturePaymentWorkflow` — verificado no fonte) ou no caminho
  de webhook; `context.idempotency_key` = session.id (authorize) / capture.id / payment.id;
  `capturePayment` em pagamento já capturado é protegido pelo módulo (row locks, over-capture) —
  o adapter a torna **barata** (sem chamada extra quando já capturada na adquirente);
  `retrievePayment` **nunca** é chamado pelo core e `updatePayment` não tem rota core no fonte
  auditado (implementar mesmo assim — métodos abstratos).
- **Auditado no clone (develop 2.21.1, 2026-09-28)**: a **PaymentSession não expira no core**
  (nenhum TTL no módulo payment) — o TTL é do **charge na adquirente** (MP `expiration_time` ·
  SumUp `valid_until` · Cielo Pix ~300 s · Stone: pedido não expira) e o adapter trata expirado
  (recriar/cancelar — specs por adquirente); **capture e refund aceitam `amount` positivo
  opcional** (parcial) no contrato HTTP — o adapter valida contra a política da adquirente;
  existe **`POST /admin/orders/:id/payment-sessions/authorize`** (2.17+, retorna
  `{ is_authorized }`) — checagem síncrona alternativa ao markAsPaid para o poll do dialog.
- **Recibo: o plugin expõe, o app ainda não imprime** (auditado no app, 2026-09-28): o
  `GET /admin/pos-payments/charges/:id/receipt` (§8) resolve o lado do plugin, mas o
  `ReceiptData` do app só tem label do método/valor/troco (`src/types/utils.ts`) — **sem NSU,
  código de autorização, bandeira ou parcelas** — e o gerador (`buildReceipt`) não aceita linhas
  extras. Campos existem e já estão mapeados (Stone: `metadata` do webhook — `scheme_name`,
  `authorization_code`, `initiator_transaction_key` · Cielo: bloco `Receipt` + comprovantes
  PPCONECTA em Base64 · MP/SumUp: 🟡 — pendências nas specs). Extensão do app via seam
  `PosPlugin` (registry de UI) — mudança de fluxo, fora do backlog Circuit (regra R1).
- `src/providers/pos-terminal/index.ts`:
  `export default ModuleProvider(Modules.PAYMENT, { services: [PosTerminalProviderService] })`.
- Opções por registro: `{ acquirer: "manual" | "mercadopago" | ..., ...credenciais }`; adapter
  resolvido por `options.acquirer` — **na Fase 1 o modo manual vive inline no service**; o
  registro em `src/adapters/` (interface comum em `src/adapters/types.ts`) entra na Fase 2
  com o primeiro adapter real.
- Estado da cobrança em `payment.metadata` (sem DB próprio no v1, sem migrations).

### 6.3 Rotas do plugin

- `GET /admin/pos-payments/health` → `{ status: "ok" }` (Fase 1).
- **Contrato de rotas do plugin** (substantivos genéricos, agnósticos de adquirente — cada
  adapter faz o mapa para a API dele). **Autenticadas, sob `/admin/pos-payments/*`** (auth do
  core — [ADR 0005](../../docs/adr/0005-superficies-api-auth-plugin.md)): `POST /admin/pos-payments/charges`
  (criar cobrança no terminal) · `GET /admin/pos-payments/charges/:id` (estado autoritativo —
  poll do POS) · `POST /admin/pos-payments/charges/:id/cancel` ·
  `POST /admin/pos-payments/charges/:id/refund` ·
  `GET /admin/pos-payments/charges/:id/receipt` (adquirentes com recibo estruturado) ·
  `GET /admin/pos-payments/terminals` + `GET /admin/pos-payments/terminals/:id/status`
  (lista/health) · `POST /admin/pos-payments/terminals/:id/select` (terminal do caixa) ·
  `GET|POST|DELETE /admin/pos-payments/connections/:acquirer` (+ `/start`, `/test` —
  Fase 2b) · `GET /admin/pos-payments/health` (Fase 1). **Pública, sob
  `/pos-payments/*`**: `GET /pos-payments/callback/:acquirer` (fluxo OAuth).
  **Webhooks usam a rota NATIVA do core** — `POST /hooks/payment/{provider}` (pública, verificada
  no fonte v2.19.0 `packages/medusa/src/api/hooks/payment/[provider]/route.ts`): responde **200
  imediato** e despacha via event bus (delay padrão **5s**, 3 tentativas — `webhook_delay` /
  `webhook_retries` nas options do `Modules.PAYMENT`) para `getWebhookActionAndData` do provider
  com `{data, rawData (Buffer do body bruto), headers}`. **O URL configurado no adquirente é
  `https://<backend>/hooks/payment/pos-terminal_<id>` — sem o prefixo `pp_`**: o módulo monta
  `pp_${segmento}` para resolver o provider (`payment-module.ts:1455-1465`); provider
  desconhecido → 200 na rota e erro no subscriber com retry ([ADR 0005](../../docs/adr/0005-superficies-api-auth-plugin.md)).
  Ações que movem estado: **`authorized` e `captured`**, com `data.session_id` obrigatório (enum
  completo no core: `authorized, captured, failed, pending, requires_more, canceled,
  not_supported, pending_authorization`). A rota é do core — o plugin não registra nenhuma rota
  pública de webhook (o namespace `/pos-payments/*` fica só para o callback OAuth). O
  processamento assíncrono depende do event bus (local no dev; Redis em prod). O poll do
  POS continua sendo o caminho primário (o webhook adianta estado — ADR 0001).
  **Por adquirente:** MP/SumUp/Stone configuram o URL nativo no adquirente; **Cielo não tem
  webhook** (sem webhook — fluxo síncrono, estado só por poll/consulta
  (`getWebhookActionAndData` devolve `not_supported`).

### 6.4 Integração no backend store-b2c

- **Reestruturar o bloco `Modules.PAYMENT`** em `medusa-config.js`: registrar `@medusajs/payment`
  **sempre**, com `providers` condicionais:
  `[ ...(stripe? [stripe-provider] : []), ...(POS_PAYMENTS_MANUAL ? [card, pix, cash, transfer] : []) ]`.
  Cada entrada: `{ resolve: "@voolulabs/medusa-plugin-pos-payments/providers/pos-terminal",
  id: "card" | "pix" | "cash" | "transfer", options: { acquirer: "manual" } }` → ids efetivos
  `pp_pos-terminal_card`, `pp_pos-terminal_pix`, `pp_pos-terminal_cash`,
  `pp_pos-terminal_transfer` — **transfer existe para o handoff de transferência não degradar
  silenciosamente para `pp_system_default`** (o app trata `type: "transfer"` no mesmo pipeline de
  session/capture — inventário do app).
- **Registro duplo (obrigatório — precede o meilisearch no próprio store-b2c):** além dos providers,
  o pacote entra no array `plugins` (`{ resolve: "@voolulabs/medusajs-plugin-pos-payments", options: {} }`)
  — **as rotas `/admin/pos-payments/*` só carregam pelo array `plugins`**; o resolve em `modules` carrega
  apenas o provider.
- `POS_PAYMENTS_MANUAL` entra em `src/lib/constants.ts` (default `false`); `true` no `.env` de dev.
- Dependência local: `"@voolulabs/medusajs-plugin-pos-payments": "file:../medusajs-plugin-pos-payments/plugins/pos-payments"`
  após `medusa plugin:build`. **Antes de qualquer deploy**: publicar no npm e trocar `file:` pela
  versão do registry — o `postBuild.js` copia o lockfile **e o `.env`** para dentro de
  `.medusa/server` e roda `pnpm i --prod --frozen-lockfile` lá (§1.3); `file:` externo quebra,
  e as `POS_PAYMENTS_*` precisam estar no `.env` copiado.
- Região Brasil ganha os 4 providers em `payment_providers` (junto de `pp_system_default`) quando
  `POS_PAYMENTS_MANUAL=true` (seed idempotente). Nota verificada no fonte: o módulo payment
  **não recusa** session de provider não vinculado à região — o vínculo região ⇢ provider é o que
  alimenta as listagens (`/store/payment-providers`) e o aviso de provider desconhecido no
  Settings do app; o seed continua obrigatório.
- **Exposição no webshop**: providers habilitados na região aparecem na listagem de pagamento
  da Store API — o storefront serve "Europe"/EUR (Stripe), então os `pp_pos-terminal_*` da
  região Brasil não vazam no checkout do webshop; se um dia o webshop servir Brasil, filtrar
  providers POS no storefront (skills de storefront: listagem por `region_id`).
- **Migrations**: o `pnpm ib` (seedOnce) **pula o `db:migrate` em banco já inicializado** —
  quando o plugin ganhar módulo com migrations (Fase 2b), o deploy precisa rodar
  **`medusa db:migrate` explícito** (migrations de plugin não executam no `start`/`develop` —
  verificado no fonte).

### 6.5 Metadata do app (seed idempotente)

`store.metadata.pos` ganha:
- `payment_methods` com **ids reais**: cash → `pp_pos-terminal_cash` (`type:"cash"`), card →
  `pp_pos-terminal_card` (`type:"card"`), pix → `pp_pos-terminal_pix` (`type:"card"` — card-like no
  v1; o app só tem cash|card|transfer), transfer → `pp_pos-terminal_transfer` (`type:"transfer"`);
- `guest_customer_email` (necessário para venda sem cliente).

**Instrumento e parcelas (Fases 2–3):** as
entradas ganham campos opcionais `instrument` (`debit`/`credit`/`voucher`/`pix`) e
`installments_max` — débito e crédito viram **métodos separados** no tender (o app atual ignora
campos desconhecidos: compatível). Na ativação da conexão, card/pix **trocam** para
`pp_pos-terminal_<acquirer>` (cash/transfer permanecem manuais); no **disconnect revertem** aos
genéricos e o health marca `disconnected`. Regra de dados: **um adquirente ativo por instrumento**.
Parcelas são escolhidas no dialog do caixa só para crédito payload-driven (Stone/Cielo);
MP/SumUp decidem no terminal e o total cobrado nunca muda com parcelamento.
**Terminais por caixa:** o espelho ganha
`registers = {register_id: {label, terminal: {acquirer → serial}}}` — binding caixa↔terminal por
adquirente (multi-caixa); resolução no charge: register → default global → erro fail-closed.

### 6.6 Critérios de aceite

- Os 5 providers (`pp_system_default` + os 4 `pp_pos-terminal_*`) habilitados na região
  Brasil — a listagem vive na Store API (`GET /store/payment-providers?region_id=` com
  publishable key; a rota `GET /admin/payment-providers` não existe no Medusa 2.19,
  verificado em 2026-09-29).
- Venda E2E com cada método grava `payments[0].provider_id` = id do método (sem queda para
  `pp_system_default`) — **fecha o débito de conciliação por `provider_id`.
- **Zero mudanças no app medusa-pos.**

## Acceptance Criteria

- [x] MUST: os 5 providers habilitados na região Brasil — verify: `node scripts/e2e-pos.mjs` (step providers registrados, via `/store/payment-providers`)
- [x] MUST: venda E2E grava `payments[0].provider_id` = id do método, sem queda para `pp_system_default` — verify: `node scripts/e2e-pos.mjs` (step provider_id preservado)
- [x] MUST: zero mudanças no app medusa-pos — verify: `git -C ../medusa-pos status` sem mudanças de código de fluxo + review
- [x] MUST: rotas sob `/admin/pos-payments/*` sem `authenticate` próprio — verify: `grep -rn "authenticate" src/api` retorna vazio
- [x] MUST: provider implementa os 10 métodos abstratos; `getPaymentStatus` nunca lança — verify: `pnpm exec vitest run` (16/16) + `pnpm exec tsc --noEmit` (0)
- [x] MUST: nenhum segredo de adquirente fora do backend — verify: revisão manual + gitleaks no CI
- [x] SHOULD: `metadata.pos` com ids reais + `guest_customer_email` (guard idempotente) — verify: `curl /admin/store` com Bearer após deploy
- [x] SHOULD: sem migrations no v1 (estado em data/metadata JSONB) — verify: `find src -path '*migration*'` vazio
