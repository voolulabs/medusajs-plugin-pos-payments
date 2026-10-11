# Spec: Fase 2 — T4 rotas admin de charges e terminais (§6.3) sobre o adapter

Extraída para o gate P1 do ADLC (ticket `T4`). Fontes: §6.3 do plano (contrato genérico de
rotas), ADR 0005 (superfícies API autenticadas), §7 do mercado-pago.md (mapa rota→endpoint),
CONSTRAINTS 1/4 (minor units; falhar alto), política de adapters (ADR 0001) e o error-handler
do framework 2.19 (mapeamento MedusaError→HTTP, verificado no dist instalado). Base: cliente
HTTP (T1), taxonomia de status (T2) e adapter/wiring (T3) já mergeados.

## 1. Escopo do ticket

- `src/api/admin/pos-payments/charges/route.ts` — `POST`: cria a cobrança na adquirente.
- `src/api/admin/pos-payments/charges/[id]/route.ts` — `GET`: estado autoritativo (poll do POS).
- `src/api/admin/pos-payments/charges/[id]/cancel/route.ts` — `POST`: cancela na adquirente.
- `src/api/admin/pos-payments/terminals/route.ts` — `GET`: lista terminais ativos.
- `src/api/admin/pos-payments/adapter-scope.ts` — resolução do adapter por request.
- `src/api/admin/pos-payments/errors.ts` — mapeamento erro do adapter → `MedusaError`.
- `src/api/admin/pos-payments/schemas.ts` — zod de body/query/param (fronteira da rota).
- `src/adapters/types.ts` — `listTerminals` entra na interface (aditivo) + tipos de domínio.
- `src/adapters/mercadopago/` — `MpAdapter.listTerminals` + mapeamento para o domínio.
- `src/types/index.ts` — bloco `posTerminal` nas options do plugin.

Fora de escopo: rota de refund (reflui pelo `refundPayment` do core), rota de simulação
(§4.5 fica para a homologação), provisionamento/select/status de terminal (2b), webhook (T5).

## 2. Resolução do adapter (decisão de desenho)

Os providers do módulo payment não são resolvíveis do container (verificado no
`@medusajs/payment` 2.19: instâncias internas ao módulo, sem método público de acesso). As
rotas então leem o bloco `posTerminal: { acquirer, accessToken, fetchImpl? }` das **options do plugin**
(array `plugins` do config module — via `getPluginOptions`, padrão ADR 0002 §5) e resolvem o
adapter por request (stateless sobre o cliente T1; nunca credencial em log). `manual` ou
bloco ausente → `NOT_ALLOWED` (400); `mercadopago` sem `accessToken` → falha alta. O bloco
espelha as options do provider no `medusa-config` (a spec do T6 unifica via env).

## 3. Contrato das rotas

- Auth do core em `/admin/*` — padrão da rota `health`; este plugin não tem `middlewares.ts`.
- Dinheiro em **minor units**: `amountMinor` inteiro > 0 no body (fronteira única — adapter
  converte para a forma da adquirente). `externalReference` obrigatória (1–64
  `[A-Za-z0-9-_]`; deve ser o id da payment session — reconciliação). `terminalId`
  obrigatório. `expirationTime` (ISO-8601 PT30S–PT3H), `description` e
  `paymentMethodDefaultType` opcionais. Contrato HTTP **camelCase** (convenção do core).
- **Idempotência determinística compartilhada com o provider**: chave
  `pos-payments-mercadopago:<external_reference>:charge` (mesma derivação do `mpInitiate`).
  - **Errata 2026-10-07 (T-CANCEL-CONTRACT): formato SUBSTITUÍDO** — chave agora é UUID v5
    canônico (`keyFor(<seed>:<purpose>, ns-do-plugin)`), MESMA derivação na rota e no
    `mpInitiate` (dedup de replay mantido); ver CHANGELOG `[Unreleased]`.
  Replay do mesmo corpo devolve a MESMA ordem (dedup da MP + reuse-guard de valor e terminal
  do T3); corpo divergente falha alto (`UNEXPECTED_STATE`, mensagem nomeia a divergência).
- Cancel com header `X-Allow-Cancelable-Status` **incondicional** (decisão do T3: a MP carrega
  a ordem no terminal em segundos; o cancel de `created` pré-carga exigiria estado local que a
  rota não tem).
- `GET /terminals`: query `limit` (1–50), `offset` (≥0), `store_id`/`pos_id` (numéricos)
  validada na fronteira (zod) e no client (`assertTerminalsQuery`). Resposta **agnóstica de
  adquirente**: `{ terminals: [{ id, storeId, posId, externalPosId, operatingMode }],
  paging: { total, offset, limit } }` — mapeamento snake_case→domínio no adapter.
- Respostas de charge: `{ chargeId, state, rawStatus, paymentId?, reasonCode?,
  retryClass?, reason? }` (view do T2 + `chargeId`).

## 4. Mapeamento de erros (verificado no error-handler do framework 2.19)

| Origem | Resposta |
|---|---|
| body/query/param fora do schema (zod) | `INVALID_DATA` → 400, mensagens das issues |
| `manual`/bloco `posTerminal` ausente | `NOT_ALLOWED` → 400 |
| `MpApiError` com status 404 da adquirente | `NOT_FOUND` → 404 |
| `MpApiError` ≠ 404 e `MpContractError` (tipos que o adapter controla) | `UNEXPECTED_STATE` → 500, mensagem interpolada do tipo |
| erro desconhecido (rede, bug) | `UNEXPECTED_STATE` → 500, mensagem GENÉRICA — nada do mundo externo ecoa cru |

## Acceptance criteria (cada uma com verify)

1. MUST `POST /charges` valida fail-closed e cria a cobrança (`charge_id` + view) —
   verify: `pnpm exec vitest run` (spec das rotas com fetch fake injetado).
2. MUST idempotência determinística: replay do mesmo corpo devolve a mesma ordem sem segunda
   criação divergente — verify: spec das rotas.
3. MUST `GET /charges/:id` devolve o estado autoritativo (view com `raw_status`) — verify:
   spec das rotas.
4. MUST cancel chama a adquirente com header incondicional e devolve a view — verify: spec
   das rotas (registro da chamada).
5. MUST `GET /terminals` valida a query e devolve `{terminals, paging}` agnóstico — verify:
   spec das rotas.
6. MUST mapeamento de erros 400/404/500 conforme a tabela da spec — verify: spec de erros
   das rotas.
7. MUST arquivos ≤100 linhas — verify: `opcore check --repo . --all`.
8. MUST lint/format/typecheck/knip verdes — verify: bateria local + steps do CI.
9. MUST cobertura global ≥90% e money paths ≥95% — verify: `pnpm test:coverage`.
10. SHOULD nenhuma dependência nova (zod via `@medusajs/framework/zod`, peer dep) — verify:
    diff do package.json contra a base.

## Erratas do build 2026-10-03 (implementação × spec)

- Contrato HTTP em **camelCase** nos dois sentidos (`amountMinor`/`chargeId`/`rawStatus`/
  `operatingMode`) — convenção do core; a redação original usava snake_case.
- O bloco `posTerminal` inclui `fetchImpl` (seam de teste injetado nas rotas).
- `:id` ausente no path → `NOT_FOUND` (guard `assertChargeId` em `schemas.ts`).
- Consertos do review r1: a recuperação de colisão 409 RE-FACHA a ordem completa
  (`getOrder`) antes do reuse-guard — a busca pode vir parcial — e o guard REJEITA
  ordem sem `config.point.terminal_id` (fail-closed no vínculo de dinheiro e
  terminal). O 404 da adquirente passa a mensagem GENÉRICA (sem interpolação do
  upstream); o 500 mantém o motivo preservado (decisão acima).
- Residuais conscientes da adversarial (rodada 1): formato MP do `terminalId`
  (`{tipo}__{serial}`) não é validado na fronteira — sai como `UNEXPECTED_STATE` (500) com o
  motivo; regex de ids numéricos (storeId/posId) existe na fronteira E no client com os
  mesmos limites; rotas não logam domínio (acesso coberto pelo http logger do core;
  auditoria de domínio fica para o T5); amounts extremos (>2^53 no JSON) degradam para o
  4xx/5xx da adquirente.
