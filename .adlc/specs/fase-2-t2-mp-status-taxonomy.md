# Spec: Fase 2 — T2 taxonomia de status (mapStatus) do Mercado Pago

> **Registro histórico** — T2 implementada, mergeada no #42 (3cf2b0d, 2026-10-03) e fechada no ticket-complete do ledger. Erratas registradas na seção de decisões. Nota do T3: os tipos `RetryClass`/`ChargeState`/`ChargeStatusView` migraram para `src/adapters/types.ts` (re-exportados aqui).
Este arquivo é o registro do ciclo concluído, não documento vivo (padrão de
`fase-1-provider-manual.md`). ACs ticados com as verificações do merge.

Extraída para o gate P1 do ADLC (ticket `T2`). Fontes do contrato: máquina de estados oficial
da Orders API (Point e QR — status-order-transaction, verificação 2026-10-01), política de
adapters fail-closed (ADR 0001 §6) e erros tipados (ADR 0002). O cliente HTTP existe (T1);
este ticket adiciona a camada PURA de interpretação de estado.

> **Errata 2 2026-10-03 (auditoria final):** onde o escopo/AC dizem "11 status_details",
> leia-se **12** (11 específicas + a genérica `failed`) — a tabela já cobre as 12.

## 1. Escopo do ticket

Mapeamento puro `MpOrder → ChargeStatusView` (estado do charge + motivo legível no caixa), com
taxonomia de retentabilidade sobre `transactions[].status_detail`:

- `status-taxonomy.ts` — tipos `RetryClass`, tabela normativa `RETRY_TAXONOMY` (11
  `status_detail` documentados → classe + copy pt-BR para o operador do caixa).
- `status.ts` — `ChargeState`, `ChargeStatusView`, `mapOrderStatus(order)` type-aware e
  fail-closed.

Fora de escopo: wiring no provider (T3), rotas (T4), webhook/reconciliação (T5).

## 2. Máquina oficial e decisões

- Point: `created → at_terminal → processed | failed | action_required | expired | canceled`;
  `canceled` pode vir do TERMINAL; `refunded` pode ser iniciado no terminal; `created` expira
  em 15 min sem processamento (server-side → `expired`).
  > **Errata 2026-10-03 (reconciliação com a doc oficial, diagrama status-order-transaction):**
  > `action_required` é ABSORVENTE — não tem saída no diagrama ("this status will not
  > change"); o resultado final vem da TRANSAÇÃO (`processed`/`accredited` → paid —
  > implementado no T3). E `canceled` também alcança `created` via API (não só o terminal).
- QR: `created → processed` direto; NÃO existem `at_terminal`/`action_required`/`failed` —
  recebê-los numa ordem `type: "qr"` é violação de contrato.
- O `status_detail` rico vive na TRANSAÇÃO (não na order). Taxonomia normativa:
  - `retry_with_change` (operador ajusta valor/dados): `insufficient_amount`,
    `amount_limit_exceeded`, `bad_filled_card_data`, `invalid_installments`
  - `not_retryable` (recusa igual ao repetir): `rejected_by_issuer`, `card_disabled`,
    `max_attempts_exceeded`, `high_risk` (antifraude — o MP alerta contra tentativas
    consecutivas semelhantes; sem classificação oficial de reversibilidade, o conservador é
    não retentar; decisão pós-CodeRabbit #42, 2026-10-03)
  - `retryable` (pode tentar de novo): `processing_error`
  - `escalate` (escala humana): `in_review`, `required_call_for_authorize`
- Estado do charge (`ChargeState`): `pending`, `awaiting_terminal`, `action_required`, `paid`,
  `failed`, `expired`, `canceled`, `refunded`. NENHUM estado MP produz `processing` no v1
  (decisão registrada; o poll do T3 não sintetiza estado otimista).
- Fail-closed TOTAL: status fora do enum e estado proibido na máquina qr → `MpContractError`
  (nunca default silencioso). `status_detail` desconhecido → degradação conservadora
  (`not_retryable`) com `reasonCode` cru preservado; copy nunca vazia.
- Cancelamento distingue origem: pela tabela oficial da TRANSAÇÃO, o status é `canceled` e a
  origem vive no `status_detail` (`canceled_by_api` | `canceled_on_terminal`) — a origem é lida
  do `status_detail` (tolerância documentada: também aceita no campo `status`).
- `type` da order: `point` e `qr` são os valores do escopo presencial; AUSENTE é tratado como
  `point` (decisão registrada); qualquer outro valor presente (ex.: `online`) → `MpContractError`.
- O contrato presencial traz UM pagamento por ordem: mais que isso → `MpContractError`,
  validado no `mapOrderStatus` ANTES da seleção do ramo (todos os estados, inclusive
  `processed`/`refunded` — não só os ramos com motivo).
- Defesa de protótipo: lookup por `hasOwnProperty` — chaves herdadas (`toString`, `constructor`)
  não viram estado nem entrada de tabela.
- `ChargeStatusView` carrega `rawStatus` (sempre) e `paymentId` (quando a ordem traz) para o
  wiring do T3 (refund/auditoria não reabrem a ordem).
- Arquivos: `status-taxonomy.ts`, `status.ts`, `status-view.ts` (construtores de view).
- `action_required` é estado TERMINAL na doc oficial ("this status will not change") — a view
  carrega copy de orientação ("Verifique o terminal…") para o operador (risco de dupla cobrança).
- A taxonomia cobre os 12 `status_detail` de transação failed documentados (11 específicos +
  o genérico `failed` → not_retryable com copy própria); `CANCEL_ORIGINS` inclui o genérico
  `canceled` (linha canceled/canceled da tabela oficial).
- Wiring (T3/T5): capturar `MpContractError` POR ORDEM no poll/reconciliação — registrar e
  continuar o lote, nunca abortar o loop por violação de contrato de uma ordem.
- A cardinalidade é garantida uma ÚNICA vez, em `assertMappable` (status.ts) — `singlePayment`
  é leitor puro (sem throw duplicado, sem risco de divergência de mensagem).
- Ordens `processed`/`refunded` SEM `payments[]` permanecem `paid`/`refunded` sem `paymentId`:
  semântica oficial ("payment was credited"); o wiring reconcilia/re-consulta. REVISAR com
  payloads reais na homologação (follow-up T2.1, quando houver credenciais sandbox).
- `processing_error` (`retryable`) orienta contatar o suporte na copy — a doc oficial manda
  fornecer o `x-request-id`; expô-lo na view fica para o wiring (T3/T5).
- Máquina QR oficial inclui o estado `processing` (ausente no v1 point-only): o adapter falha
  fechado (`MpContractError`) até o ticket de QR (Fase 2b) mapeá-lo.

## Acceptance Criteria

- [x] MUST: mapeamento total dos 8 estados point e dos 5 válidos qr, sensível ao `type`
      — verify: `pnpm exec vitest run` (`__tests__/status.spec.ts`)
- [x] MUST: fail-closed — status fora do enum e estado proibido na máquina qr lançam
      `MpContractError` — verify: `__tests__/status.spec.ts`
- [x] MUST: taxonomia normativa completa (11 status_details → 4 classes) com copy pt-BR não
      vazia por entrada — verify: `__tests__/status-taxonomy.spec.ts`
- [x] MUST: `status_detail` desconhecido degrada para `not_retryable` preservando o
      `reasonCode`, sem lançar — verify: `__tests__/status.spec.ts`
- [x] MUST: cancelamento expõe origem api/terminal; `refunded` expõe estado próprio
      — verify: `__tests__/status.spec.ts`
- [x] MUST: arquivos ≤100 linhas — verify: `opcore check --repo . --all`
- [x] MUST: lint/format/typecheck/knip verdes — verify: bateria local + steps do CI
- [x] MUST: cobertura global ≥90% e money paths ≥95% — verify: `pnpm test:coverage`
- [x] SHOULD: nenhuma dependência nova em `dependencies` — verify: diff do package.json
      contra a base
- [x] MUST: valores hostis não viram estado — chaves herdadas de protótipo (status/detail),
      `type` presente fora do escopo e ordem com múltiplos pagamentos falham fechado; origem do
      cancelamento lida do `status_detail` da transação
      — verify: `__tests__/status.spec.ts` + `__tests__/status.failures.spec.ts`
- [x] MUST: `action_required` carrega copy de orientação ao operador; details genéricos
      `failed`/`canceled` têm entradas próprias na taxonomia
      — verify: `__tests__/status.spec.ts` + `__tests__/status-taxonomy.spec.ts`
- [x] MUST: `high_risk` classificado `not_retryable` (antifraude) e cardinalidade de
      pagamentos validada antes da seleção do ramo do estado
      — verify: `__tests__/status-taxonomy.spec.ts` + `__tests__/status.failures.spec.ts`
