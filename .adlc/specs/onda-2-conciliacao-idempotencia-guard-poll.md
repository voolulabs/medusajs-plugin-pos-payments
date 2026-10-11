# Onda 2 — conciliação periódica, idempotência retentável, guard de options e poll da captura (pos-payments)

Status: aguardando aprovação humana (P1)
Ticket: T-ONDA2 (a criar via `adlc ticket create`)
Base: origin/develop (d76c91a)
Risco: caminho de dinheiro (refund) — substantial

## Contexto

Onda 2 do plano de patches (diagnóstico 2026-10-05, A6/A7/A10/A11 + F2/W2.5): fecha as
arestas declaradas do ciclo L3 de sandbox. Fontes: dist @medusajs/* 2.19, doc oficial
Mercado Pago Orders API (out/2026), execução real L3 13/13.

## Comportamento entregue (spec do estado final)

1. **Conciliação periódica (A7/W2.2)** — job agendado `pos-payments-reconcile`
   (cron diário 04:00, primeiro job do plugin — errata 2026-10-07 no ADR 0002):
   varre os payments capturados do provider `pp_pos-terminal_mercadopago` dos últimos
   30 dias via graph `entity: "payment"` (filtro de coluna `provider_id` + janela
   `captured_at` $gte; recorte JSONB `data.state === "paid"` em memória), re-fetcha o
   charge na Orders API e, quando a ordem está `refunded` e o payment do Medusa está
   capturado sem refund, executa `refundPaymentWorkflow` com a MESMA transactionId do
   subscriber (`pos-payments-reconcile:<payment_id>`). Presence-gated: sem
   `posTerminal.acquirer: "mercadopago"` o job não resolve nada. Janela de 30 dias:
   resíduo 31–90d (refund MP vale 90d) segue dependendo do reenvio do MP.

2. **Erros de idempotência retentáveis (A10/W2.3)** — 423 `resource_locked` e 500
   `idempotency_validation_failed` (únicos "Idempotency Error" com retry na doc oficial
   da Orders API) levantam `MpIdempotencyRetryableError` (`retryable: true`, herda
   `Retry-After`); 409 `idempotency_key_already_used` segue no caminho de re-consulta;
   500 genérico e 423 com outro corpo continuam `MpApiError`.

3. **Guard de consistência de options (A6/W2.1)** — na primeira resolução do provider
   (loader lazy), a entrada NÃO-manual do módulo payment é comparada ao bloco
   `posTerminal` do plugin: divergência falha alto citando só NOMES de chaves.
   Providers manual ficam isentos (não consomem o bloco). Sem `CONFIG_MODULE`
   resolvível: degrada com `info` (contra-drift, não barreira de segurança).

4. **Poll reflete captura (A11/W2.6, defensivo)** — `captured_at` no blob do provider
   vence: `getPaymentStatus` devolve `captured` sem reconsultar a adquirente.
   Verificado no core 2.19: sem caller no core/SDK (superfície do app = rota
   `/charges/:id`); correção alinha o mapa para callers futuros/harnesses.

5. **Docs e e2e (W2.4/W2.5)** — README com orçamento de entrega do webhook
   (`webhook_retries`/`webhook_delay`, options do módulo payment, verificadas no dist
   2.19) e o job; CONSTRAINTS/CLAUDE com a regra de unidades (G4); erratas ADR
   0002 (jobs entram) e 0007 (segunda origem de escrita do refund); CHANGELOG
   Unreleased; L3 ganha cenários recusado (Use case 2 oficial), action_required+cancel
   e expired, com assert de nunca-captura no banco.

## Acceptance criteria (verificação concreta)

1. **MUST** — Job reconcilia refund de terminal perdido: payment capturado
   (`data.state === "paid"` em `payment.data`) com ordem `refunded` na MP e sem refund
   no Medusa dispara `refundPaymentWorkflow` com o payment certo.
   *Verify:* unit do runner (`createReconcileRunner` — `refundTotal` chamado com o
   payment id; outcome `refunded`) + fiação do job com container stub (graph `payment`
   → adapter via `fetchImpl` → `refundPaymentWorkflow` mockado) — arquivo
   `src/jobs/__tests__/pos-payments-reconcile.spec.ts`.
2. **MUST** — Job NÃO reembolsa: payment já reembolsado (guarda de refunds), não
   capturado, ordem ainda `paid` na MP (noop) e falha em UM payment não derruba a
   varredura (warn e segue). *Verify:* `pos-payments-reconcile.spec.ts` — 4 casos
   com asserções exatas: `refundTotal` NÃO chamado (skips), outcome `noop`, e
   `refundTotal` chamado 1× com `logger.warn` quando o primeiro de dois payments
   falha (`getCharge` lança) e o segundo é reconciliado.
3. **MUST** — Job idempotente e exclusivo: MESMA transactionId do subscriber
   (`pos-payments-reconcile:<payment_id>`). *Verify:* caso de fiação + errata
   2026-10-07 no ADR 0007 (row lock `FOR UPDATE` do `refundPayment_` no dist 2.19).
4. **MUST** — Presence-gated e cron: sem `posTerminal.acquirer mercadopago` o job não
   resolve LOGGER/QUERY; `config` expõe name `pos-payments-reconcile` e schedule
   `0 4 * * *`. *Verify:* `pos-payments-reconcile.spec.ts` — caso com container cujo
   `resolve` lança para qualquer chave fora de CONFIG_MODULE (job termina sem
   exceção) + asserção literal de `jobConfig.name`/`jobConfig.schedule`.
5. **MUST** — 423 `resource_locked` e 500 `idempotency_validation_failed` levantam
   `MpIdempotencyRetryableError` com `retryable: true` e `Retry-After` consumido;
   423 com outro corpo e 500 `internal_error` continuam `MpApiError`. *Verify:*
   `client.errors.idempotency.spec.ts` (pares oficiais + negativos).
6. **MUST** — Guard de consistência: divergência não-manual falha na resolução citando
   só NOMES de chaves (nunca valores); providers manual isentos; bloco ausente com
   provider mercadopago falha; sem `CONFIG_MODULE` degrada com `info` sem `warn`.
   *Verify:* `options-consistency.spec.ts` + `service.webhook-options.spec.ts`.
7. **MUST** — Poll: `captured_at` vence sem reconsultar a adquirente; sem
   `captured_at` o mapa não muda. *Verify:* 2 casos em `service.mp.spec.ts`.
8. **MUST** — Gates locais verdes: ESLint `--max-warnings 0`, Prettier, knip,
   `tsc --noEmit`, vitest (296), build, opcore (≤100 linhas/função), commitlint,
   `adlc spec-lint` + `gate-manifest verify`, shellcheck + semgrep.
   *Verify:* `pnpm ci:local` (14 estágios) no WSL com exit 0.
9. **MUST** — L3 com os cenários novos (recusado Use case 2, action_required+cancel,
   expired) e assert de nunca-captura em todos. *Verify:*
   `node e2e/l3-webhook-e2e.cjs` na pilha de dev do WSL — `[pendente]` execução
   pós-merge (exige backend vivo, túnel e painel MP).
10. **MUST** — Docs dizem só o que o código faz (README, ADR 0002/0007 erratas,
    CHANGELOG, CONSTRAINTS/CLAUDE). *Verify:* duas checagens — (a) `grep -rn
    "definitiva" CHANGELOG.md docs/adr/` vazio e `grep -n "no boot\|at provider boot"
    plugins/pos-payments/src CHANGELOG.md` vazio no working tree do PR; (b) revisão
    adversarial local read-only em loop com veredito SHIP e ZERO achados (rodada 1:
    NÃO-SHIP F1–F11 corrigidos; rodada 2: SHIP COM AJUSTES G1–G6 corrigidos; rodada 3:
    agente fresco sobre o delta; nova rodada a cada achado), registrada como P5 no PR
    via `adlc gate-manifest record code-rabbit --ticket T-ONDA2`.

## Fora de escopo deste ticket

- Fase 2b (onboarding Admin, lojas/caixas), homologação física (seção E da #55),
  produção (medição ≥73), locking explícito T6, janela configurável do job.

## Evidências anexas

- Revisão adversarial local: rodada 1 NÃO-SHIP (F1–F11) → corrigido; rodada 2 SHIP COM
  AJUSTES (G1–G6) → corrigido; rodada 3 em curso. Claims de core 2.19 verificados no
  dist por dois revisores independentes.
