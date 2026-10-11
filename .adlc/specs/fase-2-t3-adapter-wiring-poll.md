# Spec: Fase 2 — T3 adapter na interface comum + wiring no provider + poll 10s/40s

> **Registro histórico** — T3 implementada, mergeada no #43 (a1908e1, 2026-10-03) e fechada no ticket-complete do ledger (seq 55). Módulos finais incluem `reuse-guard.ts`, `charge-input.ts`, `search.ts` e `service-mp-refund.ts` (emendas das revisões registradas abaixo).
Este arquivo é o registro do ciclo concluído, não documento vivo (padrão de
`fase-1-provider-manual.md`). ACs ticados com as verificações do merge.

Extraída para o gate P1 do ADLC (ticket `T3`). Fontes: contrato oficial Orders API (poll do
plugin), CONSTRAINTS 2/4/6 (máquina de transições com mutator único; falhar alto; data_version),
logs D1/D2 (logger estruturado com correlação; info=transição, warn=409 fila/4xx, error=5xx) e
política de adapters (ADR 0001). Base: cliente HTTP (T1) e taxonomia de status (T2) já mergeados.

## 1. Escopo do ticket

- `src/adapters/types.ts` — interface `PosPaymentsAdapter` (`acquirer`, `createCharge`,
  `getCharge`, `cancelCharge`, `refundCharge`); dinheiro em **minor units** no domínio.
- `src/adapters/mercadopago/adapter.ts` — implementa a interface sobre o cliente T1 +
  `mapOrderStatus` (T2) + `money.ts`; **idempotency key por parâmetro** (derivada e persistida
  pelo provider ANTES do envio).
- `src/adapters/index.ts` — `resolveAdapter(options)`: `manual` → sem adapter (comportamento
  atual intacto); `mercadopago` → MpAdapter; desconhecida → falha alta.
- `src/providers/pos-terminal/charge-state.ts` — `ALLOWED_TRANSITIONS` + mutator único
  `transition(from, to)` sobre o vocabulário `ChargeState` do T2; grava `state` +
  `data_version` no blob `data`.
- `src/providers/pos-terminal/service.ts` — wiring por `options.acquirer`.

Fora de escopo: rotas HTTP (T4), webhook/subscriber (T5), registro presence-gated por
credencial de ambiente (T6).

## Erratas 2026-10-03 (auditoria spec × código)

- Prefixo real da chave de idempotência: `pos-payments-mercadopago:<id>:<propósito>`.
  - **Errata 2026-10-07 (T-CANCEL-CONTRACT): formato SUBSTITUÍDO** — a chave agora é
    UUID v5 canônico determinístico (`keyFor`, módulo `idempotency-key.ts`, namespace
    fixo do plugin; doc MP aceita "UUID v4 ou random string"). O formato legado desta
    linha saiu do código — ver CHANGELOG `[Unreleased]` e
    `.adlc/specs/cancel-contrato-ponto-mp.md`.
- `getPaymentStatus` mapeia os **8** estados (não 7).
- Logs não têm campo `attempt`; `external_reference` só no log de criação; 5xx hoje é
  `warn` (o nível `error` de D2 fica para o wiring do T5).
- `mp-status.ts` (105) e `adapter.ts` (101) excedem momentaneamente o orçamento de 100
  linhas — junto com `service.ts` legado no ticket de refactor.

## Erratas 2 2026-10-03 (auditoria final: specs × código × docs oficiais ao vivo)

- A bala "header condicional do cancelamento" está **superseded** pela decisão
  INCONDICIONAL (última emenda). Conflito documentado na própria MP: a página de
  referência do cancel-order do Point NÃO documenta o header e diz que só `created`
  cancela via API (409 `cannot_cancel_order` para `at_terminal` — "do terminal");
  o header só aparece na doc de migração. Decisão incondicional mantida: sem efeito
  adverso documentado em `created`, e o 409 tem tratamento próprio (warn +
  UNEXPECTED_STATE).
- `POLL_WINDOW` (10s/40s) é **contrato do chamador** (app/core) — o plugin é passivo
  (1 consulta por `getPaymentStatus`; erro degrada pending); a constante é documental.
- O `data` da session valida em `providers/pos-terminal/schema.ts` (prototype-polling +
  zod + merge) antes de persistir — fronteira não listada no escopo original.
- Busca oficial (`GET /v1/orders`): `begin_date`/`end_date` RFC 3339 **obrigatórios**
  (enviamos); paginação do request usa `page`/`page_size` (não usamos); refund parcial
  referencia `transaction_id` (erro `transaction_not_found`); refund individual nasce
  `processing` antes de `refunded`.


## Emendas do build (rodada de implementação)

- **Estorno do Point é TOTAL** (contrato oficial, sem body/amount): `refundCharge` da interface
  não recebe amount; reembolso PARCIAL é recusado pelo provider ANTES de chamar a adquirerente
  (`UNEXPECTED_STATE`) — sem estorno silencioso total.
- **`service.ts` (legado da Fase 1) fica acima de 100 linhas** com o wiring; o código MP novo
  vive em `service-mp.ts`/`service-mp-ops.ts`/`mp-status.ts`/`charge-state.ts` (todos ≤100).
  Fatorizar o legado fica para um ticket de refactor próprio.
- **`fetchImpl` entra como option aditiva** (CONSTRAINTS 5) — seam de teste; produção usa o
  fetch global.
- **Idempotência determinística**: chave = `pos-terminal:<session_id>:<propósito>`; sem id de
  sessão o initiate FALHA ALTO (nunca chave aleatória = nunca ordem duplicada); id de sessão
  fora do alfabeto da external_reference também falha alto (sem sanitização silenciosa).
- **`action_required` é ABSORVENTE no nível da order** (doc oficial: "will not change") —
  quem confirma o resultado é a TRANSAÇÃO: `payments[].status = "processed"` ou
  `status_detail = "accredited"` promove o charge para `paid` (senão permanece com copy de
  "verifique o terminal").
- **Cancelamento em `awaiting_terminal`** envia o header condicional
  `x-allow-cancelable-status: at_terminal` (contrato oficial; sem ele só `created` cancela).
- **Reembolso** (ERRATA da rodada 2): o core passa `refund.raw_amount` — objeto
  `BigNumberRawValue { value }` em unidades MAIORES (@medusajs/payment 2.21.2) — normalizado
  para minor e comparado com o `amount_minor` do blob (diferente = recusa ANTES da
  adquirente; ausente = falha alto).
- **CodeRabbit #43 (7 achados, todos tratados)**: divergência de valor na ordem
  reutilizada falha alto no create (nunca segue com valor antigo); `toMinor` fail-closed
  (aceita `BigNumberRawValue`, rejeita não-inteiro); estado terminal local NUNCA é
  sobrescrito pelo poll (preserva + warn); refund exige `amount` do core, monta a chave
  com o montante (`refund:<amount_minor>`) e compara pós-normalização; describe renomeado.
- - **Cancelamento**: header `x-allow-cancelable-status: at_terminal` INCONDICIONAL — a MP
  carrega a ordem no terminal em segundos e o blob local chega atrasado (o header é
  concessão, sem efeito adverso documentado em `created`).

## 2. Decisões de desenho

- **Falhar alto**: `validateOptions` aceita `manual` e `mercadopago`; registro `mercadopago`
  sem credencial nas options **falha no boot** (nunca degradar para manual).
- **Estado no blob `data`** (sem DB próprio): `charge_id`, `acquirer`, `state`, `data_version`
  (CONSTRAINTS 6 — versiona desde o primeiro estado novo).
- **Mutator único**: `transition(from, to)` valida contra `ALLOWED_TRANSITIONS` e rejeita
  transição proibida com erro tipado; poll e (futuro) webhook convergem nele (CONSTRAINTS 2).
- **Mapeamento ChargeState → status Medusa** (getPaymentStatus, nunca lança — erro degrada
  `pending`). ERRATA DO BUILD (verificado no @medusajs/types 2.21.2): `PaymentSessionStatus`
  NÃO tem `requires_action` nem `refunded` — a união real é `authorized | captured | pending |
  requires_more | error | canceled | pending_authorization`. Mapeamento final:
  `pending` → `pending`; `awaiting_terminal`/`action_required` → `pending_authorization`
  (o "confira o terminal" do caixa vem da view, nas rotas do T4); `paid` → `authorized`
  (capture do core segue; capture do adapter é confirmação LOCAL); `failed` → `error`;
  `expired`/`canceled` → `canceled`; `refunded` → `captured` (refund vive no PAYMENT; a
  reconciliação é do T5).
- **Janelas de poll**: transições típicas ≤10s; `action_required` até 40s — o plugin **não
  desiste antes de 40s** e **NUNCA converte tempo em falha**: `expired` só vem do estado da MP.
- **Logs D1/D2**: `logger_` com `provider_id`, charge id, `external_reference`, `attempt`;
  `info` = transição de estado (antes→depois); `warn` = 409 fila de terminal/4xx; `error` = 5xx;
  nunca credencial/token (D3).

## Acceptance Criteria

- [x] MUST: `resolveAdapter` para manual/mercadopago/desconhecida (falha alta na desconhecida)
      — verify: `pnpm exec vitest run` (`__tests__/adapters.spec.ts`)
- [x] MUST: MpAdapter create/get/cancel/refund no contrato, idempotency key por parâmetro,
      dinheiro minor→decimal pela `money.ts` — verify: `__tests__/adapter.mercadopago.spec.ts`
- [x] MUST: `ALLOWED_TRANSITIONS` + `transition(from,to)` com teste de TODAS as transições
      válidas e rejeição das proibidas — verify: `__tests__/charge-state.spec.ts`
- [x] MUST: provider mercadopago persistindo `charge_id`/`acquirer`/`state`/`data_version` no
      initiate e `getPaymentStatus` mapeando os 7 estados sem lançar — verify:
      `__tests__/service.mp.spec.ts`
- [x] MUST: poll não reporta timeout como falha (`awaiting_terminal` e
      `action_required` → `pending_authorization` na união real do
      `PaymentSessionStatus` — ver Emendas do build) — verify:
      `__tests__/service.mp.spec.ts`
- [x] MUST: logs D1/D2 nas transições com campos de correlação e sem credencial (spy do
      `logger_`) — verify: `__tests__/service.mp.spec.ts`
- [x] MUST: `validateOptions` manual|mercadopago, com falha no boot sem credencial — verify:
      `__tests__/service.mp.spec.ts`
- [x] MUST: arquivos ≤100 linhas — verify: `opcore check --repo . --all`
- [x] MUST: lint/format/typecheck/knip verdes — verify: bateria local + steps do CI
- [x] MUST: cobertura global ≥90% e money paths ≥95% — verify: `pnpm test:coverage`
- [x] SHOULD: nenhuma dependência nova em `dependencies` — verify: diff do package.json
