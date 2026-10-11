# Contrato de cancelamento Mercado Pago Point — mapeamento por estado na rota (pos-payments)

Status: aguardando aprovação humana (P1)
Ticket: T-CANCEL-CONTRACT
Base: origin/develop (6fa18d0 — pós Onda 2)
Risco: caminho de dinheiro (cancelamento de cobrança) — substantial
Plano de origem: workspace `/pos` → plano-acao-cancel-mp-2026-10-07.md (E1–E9, MC1–MC6, RA–RF, D1–D5)

## Contexto

O ciclo L3 pós-Onda 2 (2026-10-07, 20/22) expôs que o cancelamento do plugin assume a
semântica "cancelar = 200 síncrono". A pesquisa nas fontes oficiais (mercado-pago.md §4.3,
errata da errata 2026-10-07) provou outro contrato [ok]:

- **E1/E2 [ok]** — Cancel order (.mx, atual): `created` cancela **200**; `at_terminal`
  cancela **com o header `x-allow-cancelable-status: at_terminal`** → **202 assíncrono**;
  `action_required`/`expired`/`processed` → **409** não cancelável.
  Fontes: mercadopago.com/developers/pt/docs/mp-point/orders-api/cancel-order (versão .mx)
  e /mp-point/resources/status-order-transaction.
- **E3/E4 [ok]** — 202: a ordem PERMANECE `at_terminal`; o status_detail da transação vira
  `cancellation_requested`; o webhook confirma; **o terminal pode priorizar a cobrança e não
  completar o cancelamento — a captura pode acontecer após o 202**.
  Fonte: /mp-point/payment-processing ("Cancel an order") + /mp-point-v2 (diagrama).
- **E5/E8 [ok]** — Header CONDITIONALLY REQUIRED (só tem efeito em `at_terminal`; ignorado
  em `created`) e idempotency key "UUID v4 ou string aleatória".
  Fonte: /mp-point/migrate-payment-intent-to-orders.
- **E9 [ok]** — A documentação diverge por região (.br desatualizada × .mx atual) E por
  idioma dentro da mesma região (.br EN atualizada × .br PT velha) — migração em curso.
  Fonte adotada: páginas EN mais novas + migration guide + sandbox.
- **409s adicionais [ok]** — `order_already_canceled` (idempotência de cancelamento) e
  `cannot_cancel_order` (estado não cancelável).

Contratos do core Medusa 2.19 verificados no dist + docs oficiais [ok]:

- **MC1** — `cancelPayment` do módulo payment está ÓRFÃ: sem workflow no core-flows e sem
  rota admin HTTP (só capture/refund) → a rota do plugin é a ÚNICA superfície de
  cancelamento (fonte: payment-module.js:523, core-flows 2.19).
- **MC2** — o subscriber de payment-webhook do core descarta CANCELED/FAILED/PENDING/…
  (só authorized/captured seguem) → cancelamento não vira evento útil do core.
- **MC4** — `MedusaError.Types.CONFLICT` → 409 MAS o error-handler do framework
  SOBRESCREVE a mensagem (texto de idempotência do core) → a rota tem que responder
  `res.status(...).json(...)` DIRETAMENTE (framework/http error-handler.js:46–83 + docs).

Defeitos atuais no plugin (file:line no develop 6fa18d0) [ok]:

1. `src/api/admin/pos-payments/errors.ts` — MpApiError 409 cai em UNEXPECTED_STATE →
   **HTTP 500** para `cannot_cancel_order`/`order_already_canceled` (deveria ser 409
   semântico com o código da MP no corpo).
2. `src/api/admin/pos-payments/charges/[id]/cancel/route.ts` — cancelamento em
   `at_terminal` (202 assíncrono) responde **200** com view `awaiting_terminal` e SEM
   sinal de "cancelamento solicitado" — o caixa não distingue "cancelado" de
   "cancelamento pedido, aguarde".
3. `src/adapters/mercadopago/orders.ts:15` — header condicional via
   `opts.allowAtTerminal`; decisão D2a: INCONDICIONAL (a MP carrega a ordem no terminal em
   segundos e o blob local chega atrasado; em `created` o header é ignorado).
4. `src/providers/pos-terminal/service-mp-ops.ts` — `keyFor` gera
   `pos-payments-mercadopago:<id>:<purpose>`: determinístico mas fora do formato
   documentado ("UUID v4 ou string aleatória") → D4: `uuidv5(<chargeId>:<purpose>, ns)`
   fixo do plugin.
5. `src/subscribers/pos-payments-webhook.ts` — charge `canceled` (origem terminal) cai no
   caminho de reconciliação de refund e sai como WARN "reconciliacao pulada": estado
   esperado, não anomalia → noop com log `info` + errata no ADR 0007.

## Comportamento-alvo (spec do estado final)

1. **Rota cancel com contrato por estado (D1/D2)** — POST
   `/admin/pos-payments/charges/:id/cancel` responde DIRETAMENTE em `res` (não lança para
   o error-handler do core):
   - MP `created` → ordem `canceled` → **200** `{chargeId, ...view}` (view state
     `canceled`).
   - MP `at_terminal` (202 assíncrono) → ordem permanece `at_terminal` com
     `cancellation_requested` na transação → **202** `{chargeId, ...view}` com
     `view.cancelRequested === true`.
   - MP 409 `cannot_cancel_order` → **409** `{code:"cannot_cancel_order", message, state}`
     (mensagem preservada — MC4).
   - MP 409 `order_already_canceled` → **re-fetch** da ordem: `canceled` → **200**
     idempotente (mesma forma do refund resiliente, ADR 0001); estado divergente → **409**
     com o estado real no corpo.
   - Demais erros → `toMedusaError` como hoje (404 NOT_FOUND; resto UNEXPECTED_STATE 500).
2. **Header incondicional (D2a)** — `cancelOrder` envia
   `x-allow-cancelable-status: at_terminal` em TODA chamada (ignorado pela MP em
   `created`); a opção `allowAtTerminal` sai da camada MP (a interface comum do adapter
   mantém a assinatura para adapters futuros).
3. **`cancelRequested` na view (A1.3)** — `ChargeStatusView` ganha `cancelRequested?:
   boolean`; `mapOrderStatus` marca `true` quando ordem `at_terminal` e
   `status_detail === "cancellation_requested"` na transação (poll e cancel usam o mesmo
   caminho — o cancelamento pode NÃO se completar, E3).
4. **Idempotência uuidv5 (D4)** — `keyFor(chargeId, purpose)` = UUID v5 canônico de
   `<chargeId>:<purpose>` sob namespace fixo do plugin (determinístico: mesma charge+purpose
   → mesma key; formato aceito pela doc). Sem dependência nova: SHA-1 + namespace via
   `node:crypto`, helper puro property-testável.
5. **Subscriber noop para canceled (A1.7)** — evento assinado cujo charge está `canceled`
   (origem terminal) → log `info` "cancelado no terminal, nada a reconciliar" e retorno
   (sem refund, sem WARN); errata no ADR 0007 registrando o descarte do core (MC2) e o
   noop do plugin.
6. **Testes e prova (A1.8)** — specs L2 para rota (4 cenários por estado), adapter
   (header + uuidv5), view (`cancelRequested`), subscriber (noop info). Gate do 409
   semântico provado por MUTAÇÃO: trocar o literal `cannot_cancel_order` no corpo e ver a
   suíte falhar (regra da casa: gate que nunca falhou não está provado).
7. **Contrato público documentado (A1.9)** — README (seção "Cancelamento — contrato de
   resposta" com a tabela 200/202/409), CHANGELOG `[Unreleased]` 0.1.0 (Fixed: mapeamento
   do cancel com exemplo do corpo 409; Added: `cancelRequested` na view, 202 assíncrono),
   errata ADR 0007. Divergência de docs MP (E9) citada no README.

## Acceptance criteria (verificação concreta)

- **AC1** — 200 síncrono: MP cancela ordem `created` → rota responde 200 com view state
  `canceled`. Verificar: `cd plugins/pos-payments && pnpm vitest run
  src/api/admin/pos-payments/charges/[id]/cancel/__tests__/route.cancel.spec.ts`
- **AC2** — 202 assíncrono: MP responde 202 (ordem `at_terminal`, transação
  `cancellation_requested`) → rota responde **202** com `cancelRequested: true` no corpo.
  Verificar: `cd plugins/pos-payments && pnpm vitest run
  "src/api/admin/pos-payments/charges/[id]/cancel/__tests__/route.cancel.spec.ts"`
- **AC3** — 409 semântico: MP responde 409 `cannot_cancel_order` → rota responde **409**
  com `{code, message, state}` (nunca 500; mensagem não sobrescrita pelo core). Verificar:
  `cd plugins/pos-payments && pnpm vitest run
  "src/api/admin/pos-payments/charges/[id]/cancel/__tests__/route.cancel.spec.ts"`
- **AC4** — idempotência de cancelamento: MP responde 409 `order_already_canceled` →
  re-fetch; ordem `canceled` → 200; outro estado → 409 com o estado real. Verificar:
  `cd plugins/pos-payments && pnpm vitest run
  "src/api/admin/pos-payments/charges/[id]/cancel/__tests__/route.cancel.spec.ts"`
- **AC5** — header incondicional: `cancelOrder` envia
  `x-allow-cancelable-status: at_terminal` em toda chamada, sem `opts`. Verificar:
  `pnpm vitest run src/adapters/mercadopago/__tests__/client.errors.idempotency.spec.ts`
  (ou spec própria do cancelOrder).
- **AC6** — uuidv5: `keyFor` devolve UUID canônico determinístico (mesma entrada → mesma
  saída; purposes distintas → UUIDs distintas). Verificar:
  `pnpm vitest run src/providers/pos-terminal/__tests__/service.mp.spec.ts` (ou spec
  própria do keyFor).
- **AC7** — view: ordem `at_terminal` + transação `cancellation_requested` →
  `cancelRequested === true` no `mapOrderStatus` (poll incluído). Verificar:
  `pnpm vitest run src/adapters/mercadopago/__tests__/status.spec.ts` (spec existente ou
  nova).
- **AC8** — subscriber: charge `canceled` → log `info`, nenhum refund, retorno normal.
  Verificar: `pnpm vitest run src/subscribers/__tests__/pos-payments-webhook.spec.ts`.
- **AC9** — cobertura mantida ≥90% global / ≥95% money paths. Verificar:
  `pnpm test:coverage`.
- **AC10** — prova por mutação do AC3: alterar o literal `cannot_cancel_order` → a suíte
  do AC1 falha. Verificar:
  `sed -i "s/cannot_cancel_order/cannot_cancel_order_MUTATED/" "plugins/pos-payments/src/api/admin/pos-payments/charges/[id]/cancel/route.ts" && cd plugins/pos-payments && pnpm vitest run "src/api/admin/pos-payments/charges/[id]/cancel/__tests__/route.cancel.spec.ts"` —
  saída ESPERADA: falha (o gate morde); reverter o sed logo após.
- **AC11** — README (tabela 200/202/409), CHANGELOG `[Unreleased]` (Fixed/Added), errata
  ADR 0007. Verificar:
  `grep -n "cannot_cancel_order" plugins/pos-payments/README.md CHANGELOG.md docs/adr/0007-webhook-rota-nativa-validacao-no-provider.md`

## Não-escopo (explícito)

Polling ativo de `cancellation_requested` até terminal state (D5 — Point v2), eventos de
audit (`pos_payments_audit_event`), OTel tracing, carimbo `canceled_at` no payment Medusa
(MC1/MC2), mudanças no app medusa-pos (ISSUE 13 do backlog UI), adapters Fase 3.
