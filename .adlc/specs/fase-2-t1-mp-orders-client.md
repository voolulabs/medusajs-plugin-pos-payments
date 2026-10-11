# Spec: Fase 2 — T1 cliente Orders API do Mercado Pago
> **Erratas 2026-10-03 (auditoria spec × código):** a chave de idempotência é DERIVADA
> antes do envio (determinística por sessão) e persistida no blob retornado após a
> chamada — persistência prévia não se aplica. Inventário final inclui `response.ts` e
> `terminals-validation.ts`.


> **Registro histórico** — T1 implementada, mergeada no #36 e embarcada no ciclo em desenvolvimento (2026-10-03).
Este arquivo é o registro do ciclo concluído, não documento vivo (padrão de
`fase-1-provider-manual.md`). ACs ticados com as verificações do merge.

Extraída para o gate P1 do ADLC (ticket `T1`). Fontes do contrato: Orders API oficial do
Mercado Pago (`POST /v1/orders`, `GET /v1/orders/{id}`, cancel/refund, `GET /terminals/v1`),
política de adapters em REST puro com idempotência e fail-closed (ADR 0001 §6), pirâmide de
testes e réguas de cobertura do pacote (engenharia §4).

> **Erratas 2 2026-10-03 (verificação contra docs oficiais ao vivo + código):** "base URL
> fixa" vale para a superfície do adapter — `baseUrl`/`timeoutMs` injetáveis no client são
> seam de teste. `default_installments` EXISTE no contrato oficial (Point Pro 2/3,
> `credit_card`, com `installments_cost`); a ausência no payload v1 é decisão de produto,
> não proibição do contrato. `GET /v1/orders/{id}` só retorna ordens com menos de 3 meses;
> 409 `already_queued_order_on_terminal` (uma ordem em fila por terminal) é recusa conhecida.
> **[ok] Errata 2026-10-04 (T6):** o código real é 'on', não 'for' como documentado acima
> originalmente — provado na homologação (a fila é por serial do device virtual).

## 1. Escopo do ticket

Cliente HTTP REST puro do adapter `mercadopago` — superfície Orders API + terminais, **sem**
regra de negócio de estado (o mapeamento de status é o ticket seguinte, T2). Padrão
functional core / imperative shell: construção de body e conversões puras e testadas; `fetch`
na casca com headers de idempotência.

- `client.ts` (transporte + create/get), `orders.ts` (cancel/refund), `payload.ts` (builders
  puros), `schema.ts` (parse zod fail-closed das respostas), `money.ts` (conversão única de
  dinheiro), `terminals.ts` (listagem e setup), `validation.ts` (asserts) e `types.ts`.


## 2. Requisitos obrigatórios (ADR 0001 §6)

- **Idempotência**: `X-Idempotency-Key` obrigatória em create/cancel/refund; chave derivada e
  persistida antes do primeiro envio (a persistência no provider é o ticket de wiring, T3);
  retry reutiliza a MESMA chave; `idempotency_key_already_used` → re-consultar o recurso,
  nunca recriar.
- **Dinheiro**: minor units (inteiros) no domínio; o `amount` do MP é **string decimal**
  (minor ÷ 100) — conversão única via `MathBN` com teste do caso de drift.
- **Contrato de criação**: `external_reference` (≤64 chars), `config.point.terminal_id`
  (serial), `expiration_time` ISO-8601; **`default_installments` NUNCA vai no payload**;
  cancelamento com `X-Allow-Cancelable-Status`.
- **Rede**: base URL fixa; token por options (presence-gated); `Authorization` nunca em log.
- **Falhar fechado**: resposta 2xx não é dinheiro — payload parseado com zod; fora do
  contrato → `MpContractError`, sem mutação de estado. Colisão de idempotência (409
  `idempotency_key_already_used`) vira `MpIdempotencyConflictError` para o wiring re-consultar.
- **Cancelamento**: header condicional `x-allow-cancelable-status` com o ÚNICO valor
  documentado (`at_terminal`); sem o header, só ordem em `created` é cancelável.
- **Setup**: `PATCH /terminals/v1/setup` com UM terminal por request
  (`{terminals: [{id, operating_mode}]}`), sem idempotency key (contrato).
- **Tempo**: timeout duro por chamada via `AbortSignal` (padrão 15s — orçamento do app).

## Acceptance Criteria

- [x] MUST: create/get/cancel/refund, setup e terminais falando o contrato oficial, HTTP
      mockado via `fetchImpl` injetado (o MSW fica para a casca de integração do provider, T3+)
      — verify: `pnpm exec vitest run`
- [x] MUST: idempotência em toda operação monetária — chave recebida por parâmetro (estável,
      persistida pelo wiring no T3), mesma chave no retry; colisão 409 exposta como
      `MpIdempotencyConflictError` — verify: specs de mutações/erros
- [x] MUST: conversão minor units → string decimal (`money.ts`, MathBN) com teste do caso de
      drift — verify: `money.spec.ts`
- [x] MUST: payload sem `default_installments`; `external_reference`, terminal (formato
      `{tipo}__{serial}`), `expiration_time` (PT30S–PT3H) e amount (> 0) validados ANTES do
      fetch (fail-closed) — verify: specs de validação
- [x] MUST: orçamento de ≤100 linhas por arquivo — verify: `opcore check --repo . --all` (CI)
- [x] MUST: lint/format/typecheck/knip verdes — verify: bateria local + steps do CI
- [x] MUST: cobertura nas réguas do pacote (global ≥90%, money paths ≥95%) — verify:
      `pnpm test:coverage`
- [x] SHOULD: nenhuma dependência nova em `dependencies` — verify: diff de
      `plugins/pos-payments/package.json` contra a base
