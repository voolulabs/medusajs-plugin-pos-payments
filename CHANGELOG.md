# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-10-10

### Added

- Mercado Pago adapter (T1–T5): Orders API client (orders and Point terminals),
  charge initiation on the terminal (`POST /v1/orders`), adapter over the common
  provider interface (`pp_pos-terminal_*`) with provider wiring and the poll
  cadence (10s/40s), admin routes `/admin/pos-payments/charges` (create/get) and
  `/admin/pos-payments/terminals` (§6.3), the core-native webhook route with HMAC
  verification (ADR 0007) and terminal-refund reconciliation in the subscriber,
  and refund/cancel via the Orders API.
- Mercado Pago adapter: `mapStatus` — pure order-to-charge-state mapping that is
  `type`-aware (Point vs QR official state machines), with the normative retry
  taxonomy over transaction `status_detail` (`retryable` / `retry_with_change` /
  `not_retryable` / `escalate`) and operator-facing pt-BR reason copy. Fail-closed:
  unknown order status and QR-forbidden states raise `MpContractError`; unknown
  refusal details degrade conservatively with the raw code preserved.
- `MP_POINT_TEST_MODE` guard (mercadopago, T6): charging a sandbox terminal
  (serial prefix `SBX` in the official `{type}__{serial}` format, e.g.
  `NEWLAND_N950__SBX0000001`) fails closed before any network call unless the
  option `mpPointTestMode` is explicitly enabled — on the provider
  (`PosTerminalOptions`) or the plugin `posTerminal` block that feeds the admin
  routes. Enabling is never silent — a loud warning is logged when the provider resolves (lazy construction)
  and, on the admin-route path, once per process on first use — and never
  exempts credentials (presence-gated registration preserved): test mode is
  never silent in production.
- Merchant onboarding platform (Fase 2b, onboarding.md §11): `posPayments` module
  (connection/credential/oauth_state/audit_event + migration — deploy runs
  `medusa db:migrate`), AES-256-GCM credential envelope with dual-key rotation,
  connection state machine, MP OAuth (single-use server-side state, public callback,
  urlencoded exchange, lazy single-flight refresh with atomic pair rotation,
  `invalid_grant` → `action_required: reauthorize`), validate-then-activate pasted
  credentials, stores/POS CRUD (mercado-pago.md §10.1), per-register terminal binding,
  audit catalog, Admin UI page (`settings/pos-payments`) + topbar widget. Admin UI
  adds `@medusajs/ui` + `@medusajs/icons` as devDependencies (ADR 0004).
- Scheduled reconciliation job `pos-payments-reconcile` (daily at 04:00, first plugin job —
  ADR 0002 errata 2026-10-07): scans captured payments of `pp_pos-terminal_mercadopago` from the
  last 30 days (charge state lives in `payment.data`, written by the provider's capture/refund),
  re-fetches each charge and reconciles terminal-originated refunds lost by an exhausted event
  bus within that window (MP refunds are allowed up to 90 days for physical cards — days 31–90
  still rely on the MP redelivery), reusing the subscriber's idempotent decision and transaction
  id (job×subscriber parallelism serialized by the core's refund row lock, verified in
  `@medusajs/payment` 2.19.0 — ADR 0007 errata).
- Provider options-consistency guard between the payment-module provider entry and the plugin
  `posTerminal` block — divergence on a non-manual entry fails the provider resolution (lazy;
  first session/webhook/capture) with the diverging key NAMES only, never values. Manual
  providers are exempt (they do not consume the block). Unresolvable `CONFIG_MODULE` degrades
  with an `info` log instead of breaking exotic embeds.
- Poll (A11, defensive): a persisted `captured_at` in the provider data now wins —
  `getPaymentStatus` reflects `captured` (not `authorized`). Verified against the core 2.19:
  `getPaymentStatus` has no caller in the core/SDK (the POS-facing surface is the plugin's
  `/admin/pos-payments/charges/:id` route) — this aligns the mapping for future callers and
  harnesses; no runtime behavior change in 2.19.
- Docs: README section for the webhook delivery budget (`webhook_retries` / `webhook_delay`
  core options, verified against the `@medusajs/medusa` 2.19 hook route) and the reconciliation
  job; CONSTRAINTS/CLAUDE now state the units rule explicitly (core = minor units verbatim;
  conversion only at the adapter boundary).
- Cancellation is now first-class per the Mercado Pago Orders API contract (official .mx
  docs, 2026-10-07): `POST /admin/pos-payments/charges/:id/cancel` answers **202** when
  the charge is at the terminal (async cancellation — the order stays `at_terminal` and the
  terminal may still capture), with `cancelRequested: true` when MP echoes
  `cancellation_requested`; the poll view carries `cancelRequested` while the cancellation
  is in flight. The `x-allow-cancelable-status:
  at_terminal` header is now sent unconditionally (MP ignores it for `created`, requires it
  for `at_terminal`).
- Idempotency keys are now canonical UUIDv5 under a plugin-fixed namespace (the docs accept
  "UUID v4 or random string"; v5 keeps the accepted format while staying deterministic across
  retries and processes; implemented on `node:crypto` — no new dependency, per CONSTRAINTS).
  ONE shared derivation for the routes and the provider (`mpInitiate` included) — a replay of
  the same body dedupes at the acquirer across both surfaces; the legacy
  `pos-payments-mercadopago:<seed>:<purpose>` format is gone. Note: retries that straddle the
  deploy present a NEW key at the acquirer (acceptable pre-release; the package is unreleased).
- Defensive cancel mapping: any other state echoed by a 2xx cancel answers **202** with the
  state verbatim (a successful cancel over `at_terminal` is async by contract; MP docs
  currently diverge by region and language).
- `CONSTRAINTS.md` — non-negotiable engineering constraints for payment-path
  changes (money/units, charge state transitions, `data_version`, additive
  adapter options, fail-closed, no new declared dependency — runtime, dev,
  peer or optional — without an ADR).
- `CLAUDE.md` now documents the full ADLC development cycle (per-phase commands,
  rails, evidence-ledger discipline), the engineering standards in executable
  summary form, and the verification gates with explicit tool attribution
  (opcore = code hygiene, the-open-engine; ADLC = development lifecycle with
  evidence, voodootikigod) — the repository is self-contained for any
  contributor.

### Fixed

- Packaging: subpath exports for plugin modules — the core discovers npm-installed
  plugin modules via the bare specifier `<plugin>/.medusa/server/src/modules/<name>`
  (`MEDUSA_PLUGIN_SOURCE_PATH`, verified in the core source), and the generic `./*`
  export re-prefixed that path, producing a doubled `.medusa/server/src/...` and
  MODULE_NOT_FOUND on `medusa db:migrate` with the package installed from a registry.
  Found by the verdaccio rehearsal gate (0.1.0-rc.0 against the real backend);
  regression-tested in `package-exports.spec.ts`. Providers were not affected
  (explicit export entry already).
- Money: provider agora trata o amount do core como minor units verbatim da
  moeda da região (centavos de BRL no piloto; `assertMinorAmount`) — a conversão
  anterior multiplicava por 100 e inflava a cobrança na adquirente; refund
  compara o `raw_amount` verbatim com o blob.
- Webhook: `data.id` em lowercase no canonical HMAC (nota oficial da doc de
  notifications) — entregas reais com id maiúsculo eram descartadas.
- Subscriber: aceita o id do provider com e sem o prefixo `pp_` (o core 2.19
  prefixa incondicionalmente ao path param; o 2.21 tolera ambas as formas).
- Idempotency collisions classified as "Idempotency Error" in the official Orders API error
  tables are now typed: `423 resource_locked` and `500 idempotency_validation_failed` raise
  `MpIdempotencyRetryableError` (`retryable: true`, carries `Retry-After` when present).
  Plain 500s and other 423 bodies remain generic `MpApiError`; the caller decides the backoff
  (poll degrades to pending; routes answer an honest 500).
- E2E (L3): declined-payment scenario (official Use case 2) — new charge, `failed` simulation,
  plugin poll route asserting the refusal taxonomy and a DB assert that the payment is never
  captured.
- The cancel route no longer turns acquirer refusals into HTTP 500: `cannot_cancel_order` and
  `order_already_canceled` now answer **409** with a stable public body directly from the
  route (the core error handler overwrites `MedusaError` CONFLICT messages — verified in
  2.19), e.g. `{"code": "cannot_cancel_order", "message": "A cobrança não pode mais ser
  cancelada na adquirente.", "state": "action_required"}`. `order_already_canceled`
  re-fetches and answers **200** when the charge is confirmed canceled (idempotent), per the
  refund-resilience precedent (ADR 0001).
- Mercado Pago queue-conflict 409: the test contract now uses the real error
  code `already_queued_order_on_terminal` (was `..._for_...`), per the
  2026-10-04 homologation errata. No production behavior change — the
  idempotency-conflict recovery keys on the `idempotency_key_already_used`
  error code only, so queue-conflict 409s never entered it.

### Changed

- CI: the ADLC step now also runs `adlc gate-manifest verify` (tamper-evidence
  over the append-only evidence ledger) and installs the toolkit with
  `--ignore-scripts`. Workflow comments now attribute the two toolchains
  explicitly: opcore (code hygiene, the-open-engine) is a distinct project from
  the ADLC toolkit (voodootikigod).
- Evidence ledger signing: the ADLC step receives `ADLC_MANIFEST_KEY`
  (repo secret, HMAC) so `gate-manifest verify` attests entry authorship
  instead of internal consistency only. `CLAUDE.md` documents the house
  conventions decided with this change: adversarial review before every push,
  one PR = one nature (feature vs process artifacts), specs as per-ticket
  historical records, and the Phase 1 spec closed as a historical record
  (acceptance criteria checked against the 0.0.1 deployment evidence).
- CI: local gate battery — `pnpm ci:local` mirrors the local-runnable stages of
  ci.yml before every push (14 stages: clean tree + frozen install, lint +
  format, build, tests with coverage 90/95, strict typecheck, knip, opcore, ADLC
  spec-lint + manifest verify, npm audit, gitleaks, commitlint, shellcheck,
  semgrep); secret-backed services stay CI-only (Codecov upload, FOSSA, Snyk).
  CodeRabbit auto-review enabled on develop and staging.

## [0.0.1] - 2026-09-30

First release — Phase 1: manual / terminal-present payments for Brazilian card
terminals (maquininha) on Medusa v2.

### Added

- `pos-terminal` payment provider (ModuleProvider over `Modules.PAYMENT`),
  registered as `pp_pos-terminal_card|pix|cash|transfer` — the cashier confirms
  the charge made on the physical terminal; no acquirer credentials required.
- Hardened session-`data` contract: zod validation at the boundary,
  prototype-pollution rejection (`__proto__`/`constructor`/`prototype`),
  depth-1 merge, full-blob returns (no clobbering), state guards (capture of a
  canceled charge, cancel of a captured charge), `getPaymentStatus` never throws.
- `GET /admin/pos-payments/health` — authenticated health endpoint (core admin
  auth, no custom middleware).
- Plugin factory with a single source of truth for the package name
  (`PLUGIN_NAME`) and `getPluginOptions` via `CONFIG_MODULE`.

### Tests / CI

- 36 tests; 100% statement/branch/function/line coverage; coverage thresholds
  as CI gates (global 90%, money paths 95%).
- CI: build (`medusa plugin:build`), tests with coverage thresholds, strict
  typecheck, ADLC spec gate, opcore, npm audit, Snyk, gitleaks (pinned binary),
  commitlint (Conventional Commits).
- Codecov: upload via pinned action, PR statuses (project 90%, money-paths 95%,
  patch 90%) and badge.

### Release

- Tag-driven publish workflow (`v*` on `main`): tag-must-point-to-`main` guard,
  tag = `package.json` version guard, `--provenance`, explicit dist-tag
  (`next` for prereleases, `latest` for stable).
