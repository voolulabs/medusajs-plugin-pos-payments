# ADR 0007: Webhook de adquirente na rota nativa do core, com HMAC no provider e reconciliação no subscriber

- **Status:** aceito (2026-10-04, ciclo T5)
- **Contexto:** ADR 0001 (estado por re-fetch) · ADR 0005 (superfícies API) ·
  fonte do core Medusa 2.19 (rota de hook, subscriber de webhook e enum de ações)

## Contexto e problema

A Orders API do Mercado Pago emite notificações (`topic orders`) para mudanças de estado
da cobrança no terminal — inclusive refund e cancelamento **originados no próprio
terminal**, que o fluxo do caixa (poll + markAsPaid) não enxerga. Precisávamos decidir
(1) onde a notificação entra no backend, (2) onde a assinatura `x-signature` é validada e
(3) como reconciliar estados que o core não processa.

## Fatos verificados (fonte do core 2.19)

- A rota `POST /hooks/payment/{provider}` é do core: responde **200 imediato**, emite
  `payment.webhook_received` com `{provider, payload: {data, rawData, headers}}` e agenda
  a entrega pelo event bus (`webhook_delay` 5s, `webhook_retries` 3).
- O subscriber do core chama `getWebhookActionAndData` do provider e **só processa
  `authorized`/`captured`**; resultado **sem `data.session_id` é descartado**; **não
  existe ação `refunded`** no enum do core.

## Decisão

1. **Rota nativa do core** — o plugin não registra rota pública de webhook
   (ADR 0005; o namespace `/pos-payments/*` fica só para OAuth). O URL configurado no
   painel da adquirente é `https://<backend>/hooks/payment/pos-terminal_<id>`.
2. **HMAC validado dentro do `getWebhookActionAndData` do provider** — o `rawData` (Buffer
   cru) e os `headers` chegam prontos; a validação (HMAC-SHA256 hex timing-safe do
   canonical `id:{data.id};request-id:{x-request-id};ts:{ts};`) acontece ANTES de qualquer
   processamento. Assinatura ausente/inválida = **descarte + log D6, sem mudança de
   estado e sem 4xx** (o core já respondeu 200 — o event bus não reentrega o que veio
   inválido, e um 4xx só geraria retry inútil de algo que nunca será válido).
3. **Estado por re-fetch, nunca pelo payload** (ADR 0001): o `action` devolvido usa a
   ordem re-consultada na adquirente; `external_reference` ecoa o `session_id`.
4. **Reconciliação no subscriber do plugin**: `refunded`/`canceled` originados no terminal
   não têm ação no core — o subscriber do plugin (`payment.webhook_received`, filtrado por
   provider, com revalidação da assinatura e re-fetch) cria o refund total via
   `refundPaymentWorkflow` **idempotentemente** (guarda = refunds do payment no Medusa, já
   que a entrega é tentada 3×) e audita `canceled` sem mover estado (a sessão converge
   pelo poll).

## Alternativas descartadas

- **Rota pública própria do plugin**: duplicaria fila/retry/delay que o core já fornece e
  adicionaria superfície autêntica a proteger (ADR 0005); rejeitado.
- **Validar HMAC na rota (middleware)**: o plugin não tem `middlewares.ts` e a rota é do
  core — a validação no provider mantém o descarte silencioso (200) e o contrato
  paypal-integration (`rawData`/`headers` prontos).
- **Ação `refunded` via core**: não existe no enum; forçar `captured`/`failed` para
  reconciliar refund corromperia a semântica da sessão.

## Consequências

- O secret (`webhookSecret`) é **obrigatório** no boot do provider mercadopago
  (CONSTRAINTS 4) e vive só no backend; rotação = Reset no DevPanel + `.env` + restart
  (runbook de release).
- Webhooks chegam lento por desenho (delay 5s, 3 tentativas): a UX do caixa é o poll; o
  webhook adianta estado e reconcilia o que o caixa não vê (refund de terminal).
- Duplicação deliberada da validação (provider + subscriber): cada consumidor do evento é
  responsável pela própria fronteira — remover qualquer uma das duas é regressão de
  segurança.
- **Errata 2026-10-07 (Onda 2/W2.2): segunda origem de escrita do refund** — o job
  `pos-payments-reconcile` também executa `refundPaymentWorkflow` com a MESMA
  `transactionId` do subscriber (`pos-payments-reconcile:<payment_id>`); o paralelismo
  job×subscriber fica protegido pelo row lock `FOR UPDATE` do `refundPayment_` do core
  2.19 **[ok — verificado no fonte instalado do backend-alvo: `@medusajs/payment`
  2.19.0, `dist/services/payment-module.js:479-484` — transação obrigatória ("must run
  inside a transaction to serialize concurrent refunds"), `SET LOCAL lock_timeout = '3s'`
  e `knex("payment").where("id", …).forUpdate()`; re-read de captures/refunds sob o lock
  com guarda de over-refund (:468-476); o lock nunca atravessa a chamada do provider]**,
  somado à idempotency key do refund na adquirente — resíduo T5 (sem exclusão mútua
  explícita no engine) segue registrado para a revisão com locking no T6.
- **Errata 2026-10-07 (T-CANCEL-CONTRACT): cancelado é desfecho esperado, não anomalia** —
  o subscriber trata charge `canceled` (origem terminal ou caixa) como noop com log `info`
  e retorno, sem tentativa de refund. O core já descarta `canceled` no subscriber de
  webhook (`payment-webhook` 2.19 — MC2); o WARN de "reconciliação pulada" fica para os
  estados realmente anômalos (sem sessão, não capturado, já reembolsado).
