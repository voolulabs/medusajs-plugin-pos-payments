# Fase 2 — T6: options com guard `MP_POINT_TEST_MODE` e terminal sandbox fail-closed (mercadopago)

Status: em curso (P1). Ticket: T6. Fontes: [mercado-pago.md](../../mercado-pago.md) §3/§8 +
erratas da homologação 2026-10-04 · CONSTRAINTS 4/5 · ADR 0002 §9.

## Contexto

A homologação física usa credencial de **teste** `APP_USR-` e o terminal **virtual**
`NEWLAND_N950__SBX0000001` — serial com prefixo **`SBX`** no formato oficial
`{terminal_type}__{terminal_serial}`. O terminal virtual **não conta** para a medição oficial
de qualidade da integração: teste sem hardware só existe **atrás de um guard explícito**
(env `MP_POINT_TEST_MODE` no host, espelhado em option `mpPointTestMode`), **nunca
silencioso em produção**. Hoje o plugin não conhece o guard: um backend de produção mal
configurado aceitaria cobrar um terminal de sandbox.

O registro presence-gated já existe (`validateOptions` falha o boot de `mercadopago` sem
`accessToken`/`webhookSecret` — CONSTRAINTS 4) e este ticket o preserva por regressão.

Absorvido por decisão do mantenedor ("absorva a correção", 2026-10-04): a errata da
homologação provou que o código real do 409 de fila é **`already_queued_order_on_terminal`**
("on", não "for") — o teste do cliente usa o código errado e a spec T1 documenta o errado.
O recovery de colisão (`search.ts`) já é genérico por status e não muda.

## Decisões de design

1. **Choke point único**: `MercadoPagoAdapter.createCharge` valida
   `assertTerminalAllowedByMode(terminalId, testMode)` na primeira linha — antes de
   idempotência, payload e fetch. Provider e rotas compartilham o adapter, então as duas
   entradas ficam cobertas por um só ponto.
2. **Plumbamento aditivo (CONSTRAINTS 5)**: `PosTerminalOptions.mpPointTestMode?: boolean`
   (provider) e `posTerminal.mpPointTestMode?: boolean` (options do plugin, espelhadas pelo
   `adapter-scope` nas rotas). `resolveAdapter` recebe `testMode` (default `false` — produção).
3. **Nunca silencioso**: com `mpPointTestMode=true`, o construtor do provider loga **warn**
   explícito; a recusa cita o guard pelo nome. O flag não isenta credenciais.
4. **Predicado puro** `isSandboxTerminal` (serial após `__` começa com `SBX`) — testável sem
   rede; serial malformado não é sandbox (o formato continua sob responsabilidade do
   `assertTerminalId` existente).
5. **Fixtures**: o terminal default das specs de rota passa a serial não-sandbox (postura de
   produção é o default); cenários sandbox ganham testes dedicados (recusa sem flag — zero
   chamadas de rede; passagem com flag).

## Acceptance criteria (verificação concreta)

1. **MUST** — `createCharge` recusa terminal sandbox (`NEWLAND_N950__SBX0000001`) sem o
   guard, lançando erro que cita `MP_POINT_TEST_MODE`, com **zero** chamadas ao fetch fake;
   com `testMode: true` a chamada sai. *Verify:* caso novo em
   `adapter.mercadopago.spec.ts` (assert `calls.length === 0` na recusa).
2. **MUST** — o guard vale nas duas entradas: `mpInitiate` (provider, via
   `PosTerminalOptions.mpPointTestMode`) e `POST /admin/pos-payments/charges` (via
   `posTerminal.mpPointTestMode` do plugin options). *Verify:* casos em `service.mp.spec.ts`
   e `routes.create.spec.ts`.
3. **MUST** — boot com `mpPointTestMode=true` emite warn explícito via logger. *Verify:*
   `service.unit.spec.ts` com logger spy.
4. **MUST** — presença-gated preservado: `mercadopago` sem `accessToken`/`webhookSecret`
   continua falhando o boot, com e sem o guard. *Verify:*
   `pnpm vitest run src/providers/pos-terminal/__tests__/service.unit.spec.ts` verde na
   regressão + caso novo `{ acquirer: "mercadopago", mpPointTestMode: true }` sem
   credencial lança.
5. **MUST** — 409 real: `client.errors.spec.ts` usa `already_queued_order_on_terminal`;
   `.adlc/specs/fase-2-t1-mp-orders-client.md` ganha errata datada 2026-10-04. *Verify:*
   `pnpm vitest run src/adapters/mercadopago/__tests__/client.errors.spec.ts` verde; diff
   da spec T1 com a errata.
6. **SHOULD** — fixtures de rota em postura de produção (terminal default não-sandbox).
   *Verify:* `pnpm vitest run src/api/admin/pos-payments/__tests__` verde sem flag nenhuma
   após o fixture trocar para serial não-sandbox.
7. **MUST** — gates locais: `pnpm ci:local` (14 estágios) verde antes de qualquer push.
   *Verify:* log do ci:local no report do ticket.
