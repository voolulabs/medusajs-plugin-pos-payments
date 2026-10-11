# Errata 2026-10-05 — peer range do plugin (`>=2.19.0 <3`)

Documento de errata **externo aos ADRs** (rails imutáveis — `docs/adr/**` é
congelado pelo rails-guard): registra a mudança de faixa de peer dependencies
sem editar os registros históricos. Erratas de ADR vivem em `docs/`.

## O que mudou

- `plugins/pos-payments/package.json`: peerDependencies de
  **`>=2.15.0 <3`** para **`>=2.19.0 <3`** (framework, medusa, utils), no PR #56.
- Versão do pacote: **`0.0.1` → `0.1.0`** — drop de minor em `0.x` entra em
  MINOR (ADR 0006 §4/§5, semver §4).

## Onde os ADRs dizem o valor antigo (imutáveis — corrigidos por esta errata)

- **ADR 0002** (estrutura e convenções): a seção de dependências e a seção de
  publicação citam `>=2.15 <3` — leia-se, desde esta errata, `>=2.19.0 <3`.
- **ADR 0006 §5** (compatibilidade Medusa = política de versão): cita
  `>=2.15 <3` — idem.

## Base de verificação [ok]

- Runtime **2.19.0** verificado no dist instalado (createPaymentSession,
  refundPaymentFromProvider_, roteamento do webhook).
- Referência **2.21.x** verificada no fonte do monorepo: única divergência
  funcional relevante para providers custom é a tolerância do prefixo `pp_` no
  roteamento do webhook (o 2.19 prefixa incondicionalmente). **Doc oficial: o
  path já prefixado só é aceito a partir da 2.21.2** — em 2.21.0/2.21.1 a URL
  com `pp_` não resolve o provider. O fonte develop em cache (commit
  2026-09-25) já contém a tolerância (`payment-module.ts:1459-1461`).
  Orientação operacional: manter a URL do adquirente **sans `pp_`** (funciona
  em todas as versões); o subscriber do plugin aceita as duas formas.
- Faixa **2.15–2.18 nunca foi verificada** — motivo do estreitamento.
