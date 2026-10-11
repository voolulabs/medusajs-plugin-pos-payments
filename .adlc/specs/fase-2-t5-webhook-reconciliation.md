# Spec: Fase 2 — T5 webhook orders (HMAC no provider) + subscriber de reconciliação

Extraída para o gate P1 do ADLC (ticket `T5`). Fontes: §6.2/§6.3 do plano (pipeline do
webhook), §5 do mercado-pago.md (assinatura `x-signature`), §7.2 (eco por
`external_reference`), event-bus.md §2 (pipeline verificado file:line no core 2.21),
observabilidade.md (D2/D6), ADR 0005 (superfícies API) e os fatos da homologação
2026-10-04 (notificações reais fluindo, shape `type: "order"` validado).

## 1. Escopo do ticket

- `src/providers/pos-terminal/webhook-signature.ts` — validação HMAC da MP.
- `src/providers/pos-terminal/service-webhook.ts` — `getWebhookActionAndData` real.
- `src/providers/pos-terminal/service.ts` — delegação + `webhookSecret` nas options.
- `src/subscribers/pos-payments-webhook.ts` — reconciliação do refund de terminal.
- `src/providers/pos-terminal/webhook-reconcile.ts` — decisão pura da reconciliação.
- `docs/adr/0007-webhook-rota-nativa-validacao-no-provider.md`.

Fora de escopo: rota pública própria (nunca — ADR 0005/0007), wiring das options no
medusa-config do backend (T6/deploy), reconciliação de `canceled` além de audit log
(a sessão converge pelo poll), store de dedup (operações idempotentes bastam).

## 2. Pipeline (fatos verificados no fonte)

`POST /hooks/payment/pos-terminal_mercadopago` (rota NATIVA do core — sem `pp_` no URL
configurado no painel) → core responde **200 imediato** → emite `payment.webhook_received`
com `{provider, payload: {data, rawData, headers}}` e `{delay: 5s, attempts: 3}` →
subscriber do core re-hidrata `rawData` e chama `getWebhookActionAndData` do nosso
provider. Guardas do core: resultado **sem `data.session_id` é descartado**; só
`authorized`/`captured` movem a sessão — `failed`/`canceled` são ignorados e **não existe
ação `refunded`** no enum.

## 3. Validação de assinatura (ANTES de qualquer processamento)

MAC canônico `id:{data.id};request-id:{x-request-id};ts:{ts};` em HMAC-SHA256 **hex** com o
secret do DevPanel; headers `x-signature` (`ts=...,v1=...`) e `x-request-id`; comparação
timing-safe (`crypto.timingSafeEqual`). **Sem expiração** (doc oficial — renovação via
Reset). Assinatura ausente/inválida → log D6 (warn com `provider_id` + motivo) e
**descarte sem mudança de estado e sem 4xx** (o core já respondeu 200). O subscriber do
plugin **revalida** a assinatura com o mesmo helper antes de agir (o evento é o mesmo, mas
a defesa é da fronteira de cada consumidor).

## 4. `getWebhookActionAndData` (provider)

Parseia o envelope do `rawData` (nunca confia no payload); **re-fetch** da ordem na MP
(`adapter.getCharge(data.id)` — ADR 0001); o `action` usa o estado do **re-fetch**:

| view.state (re-fetch) | retorno |
|---|---|
| `paid` | `{action: "captured", data: {session_id: <external_reference>, amount: <minor units>}}` (Point captura na aprovação). `amountMinor` é calculado SÓ na view paid — amount malformado nos outros estados não derruba o mapeamento (inclusive pós-refund na MP, quando o resultado tem que persistir) |
| `refunded` / `canceled` | `{action: "not_supported"}` — core não move; subscriber do plugin reconcilia |
| demais (`failed`, `expired`, `awaiting_terminal`, `action_required`, `pending`) | `{action: "pending"}` — no-op; o poll continua sendo o caminho primário |

`external_reference` ausente/fora do alfabeto → sem `session_id` confiável → descarte.
Qualquer exceção → `{action: "failed", data: {}}` + warn (nunca lança — o core já respondeu).
Dedup por `data.id + type`: sem store — as operações são idempotentes (re-fetch, máquina de
estados no-op no mesmo estado, refund com guarda de já-reembolsado).

## 5. Reconciliação no subscriber do plugin

Subscriber em `payment.webhook_received` filtrando `provider === "pp_pos-terminal_mercadopago"`:
re-hidrata o `rawData` serializado do event bus persistido (`{type: "Buffer"}` — a mesma
normalização que o subscriber do core faz antes de chamar o provider), valida assinatura →
re-fetch → se `refunded` (refund originado NO TERMINAL), resolve o payment por
`payment_session_id` (o `session_id` do action é o id da payment session; essa é a coluna
real e única do payment — verificada no schema do banco) e cria o **refund TOTAL** via
`refundPaymentWorkflow` do core, **idempotente**: skip quando o pagamento já está
reembolsado (o event bus tenta 3×; a 2ª entrega vê o refund existente) e quando ainda não
há captura no Medusa (`captured_at` nulo — refund de terminal antes do markAsPaid não tem
o que reembolsar). Sessão não encontrada → warn e descarte. Falha TRANSITÓRIA
(re-fetch, workflow) → warn e **re-throw**: a reconciliação é o único caminho do
refund de terminal e tem que consumir as tentativas do event bus (attempts=3) —
só falhas permanentes (assinatura, sessão inexistente) são descartadas sem retry.
`canceled` de terminal →
audit log apenas. A decisão fica em função pura (`webhook-reconcile.ts`) com dependências
injetadas — o subscriber é fiação. O `refundPaymentWorkflow` roda com `transactionId`
determinístico (`pos-payments-reconcile:<payment_id>`): redelivery do event bus não
re-executa o workflow concluído no engine, e a guarda de refunds do payment cobre os
casos posteriores. O adapter do subscriber resolve LAZY, depois do filtro de provider —
options quebradas não derrubam webhooks de outros providers.

Complemento no adapter (T5): o refund é **resiliente por estado** — falha no POST refund
com a ordem já `refunded` na MP (refund originado no terminal nasce refunded) ou com o
refund criado em trânsito re-fetcha a ordem e volta como SUCESSO; qualquer outro estado
relança o erro original (ADR 0001 — o veredito é o re-fetch, nunca o corpo do erro). Sem
isso o `refundPaymentWorkflow` da reconciliação falharia 3× e o refund nunca convergiria
no Medusa.

## 6. Options (fail-closed)

`PosTerminalOptions.webhookSecret` — `validateOptions` passa a exigir `accessToken` **e**
`webhookSecret` para `acquirer: "mercadopago"` (CONSTRAINTS 4: sem secret o webhook não é
confiável e o boot falha alto).

## Acceptance criteria (cada uma com verify)

1. MUST validar `x-signature` HMAC-SHA256 timing-safe (canonical id/request-id/ts) com
   fixtures do formato oficial e rejeitar payload adulterado — verify: `pnpm exec vitest run`
   (spec `webhook-signature`).
2. MUST descartar assinatura ausente/inválida com log D6, sem mudança de estado e sem 4xx —
   verify: spec do `service-webhook`.
3. MUST re-fetch da ordem antes do `action` (o estado vem do re-fetch, não do payload) —
   verify: spec (payload e ordem divergentes no fetch fake).
4. MUST mapear `paid`→`captured` com `data.session_id = external_reference`;
   `refunded`/`canceled`→`not_supported`; demais→`pending` — verify: spec do
   `service-webhook`.
5. MUST subscriber reconciliar refund de terminal de forma idempotente (workflow só na 1ª
   entrega; skip nas retentativas) — verify: spec do subscriber/reconcile.
6. MUST `validateOptions` exigir `webhookSecret` para mercadopago — verify: spec do service.
7. MUST arquivos ≤100 linhas — verify: `opcore check --repo . --all`.
8. MUST lint/format/typecheck/knip verdes — verify: bateria local + steps do CI.
9. MUST cobertura global ≥90% e money paths ≥95% — verify: `pnpm test:coverage`.
10. SHOULD nenhuma dependência nova (`node:crypto`) — verify: diff do package.json.
