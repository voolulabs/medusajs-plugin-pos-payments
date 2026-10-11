# Runbook de operação — Onboarding de lojista (Mercado Pago, Fase 2b)

> Operação do ciclo de vida da conexão no dia a dia. Especificação: onboarding.md
> (workspace); contrato de rotas: README "Merchant Onboarding". Página: Admin →
> Settings → POS Payments.

## 1. Conectar um lojista (OAuth, self-service)

1. Pré-requisitos de plataforma: app OAuth MP com a solução **Point**, redirect URI
   estática/https registrada, `POS_PAYMENTS_MP_CLIENT_ID/SECRET/REDIRECT_URI` no
   ambiente, `medusa db:migrate` aplicado.
2. Admin → Settings → POS Payments → **Conectar (OAuth)** → autorizar no Mercado Pago →
   o callback volta para a página com `result=ok`.
3. Na página: **Terminais do lojista** → selecionar o terminal do caixa (ou binding por
   caixa em "Terminais por caixa" com o `register_id` do app).
4. Validar: venda sandbox pelo protocolo do adapter; conferir `GET
   /admin/pos-payments/health` (conexão `connected`).

## 2. Reconexão (`action_required: reauthorize`)

Causa: refresh recusado (`invalid_grant` — token revogado/senha trocada/expiry).
1. A página mostra "ação necessária: reconectar".
2. Operador clica **Conectar (OAuth)** novamente (consentimento novo do lojista).
3. NUNCA contornar com o token de plataforma — a cobrança do lojista usa sempre o
   token dele (CONSTRAINTS 8/4).

## 3. Conexão `degraded` ("verificar conexão")

Última checagem falhou de forma transitória (5xx/timeout). Cobre novas cobranças no
adapter até revalidar: **Validar agora** (`POST .../connections/mercadopago/test`).
Persistindo o erro, seguir para reconexão (§2).

## 4. Troca de terminal / maquininha nova

1. Parear a nova maquininha no app Mercado Pago do lojista (modo PDV).
2. Admin → Terminais do lojista → **Selecionar** na nova (re-bind por caixa: clicar
   Selecionar no caixa correspondente — binding `{register_id, adquirente} → terminal`).
3. A antiga some da lista quando despareada; o health do POS reflete no próximo fetch.

## 5. Desconectar com purga

**Desconectar** (DELETE) revoga/purga segredos do storage do plugin (envelope apagado)
e mantém o audit — histórico permanece para LGPD art. 37. A conexão vai para
`disconnected`; reconectar é um fluxo novo.

## 6. Incidente com credencial (suspeita de vazamento)

1. Desconectar a conexão (purga local) e **revogar no painel MP do lojista** (troca de
   senha/credenciais).
2. Rotação da `POS_PAYMENTS_MASTER_KEY`: gerar nova, manter a antiga em
   `POS_PAYMENTS_MASTER_KEY_PREVIOUS` (dual-key) — envelopes antigos continuam
   legíveis; novas gravações já nascem na chave corrente. Após rotação completa
   (reconexão de todos os lojistas), remover a previous.
3. Registrar o incidente (LGPD art. 48) com os eventos de audit correspondentes.

## 7. Passos externos (fora da plataforma)

- Aplicação OAuth Point + credenciais de produção (plataforma, uma vez — §3 de
  onboarding.md).
- Terminal físico pareado ao `user_id` do lojista em modo PDV (lojista, no app MP).
- Sandbox virtual (`SBX*`) só com `MP_POINT_TEST_MODE=true` — nunca silencioso em
  produção.
- Homologação física e medição de qualidade: RA1 (issue #55) — produção só pós-RA1.

## 8. Diagnóstico rápido

- Página branca/404 no callback: admin do backend desabilitado
  (`MEDUSA_DISABLE_ADMIN`) — o redirect vai para `/app/...` que não existe.
- `platform_config` na hora de conectar: falta `POS_PAYMENTS_MP_CLIENT_ID/SECRET/
  REDIRECT_URI` no ambiente.
- Tabelas ausentes (500 em `connections`): deploy sem `medusa db:migrate`.
- `keyId desconhecido` no log: rotação de master key sem dual-key — reverter
  `POS_PAYMENTS_MASTER_KEY` para a chave anterior e refazer a rotação com previous.
