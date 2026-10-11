# T-ONBOARDING-2B — Fase 2b: plataforma de onboarding do lojista + piloto Mercado Pago

Status: aguardando aprovação humana (P1) — go explícito do usuário em 2026-10-09
Ticket: T-ONBOARDING-2B
Base: origin/develop (c81641c)
Risco: credenciais de adquirente (LGPD/PCI-por-arquitetura) + superfície admin nova — substantial
Fontes: onboarding.md (spec exaustiva §1–§12), plano-pos-br.md §7.1/§9, ADR 0004/0005,
mercado-pago.md §2 (OAuth) e §10.1 (stores/POS), engenharia.md §3.4 (envelope),
secret-manager.md, CONSTRAINTS.md, fonte do core (merge-plugin-modules.ts +
get-resolved-plugins.ts — módulos de plugin auto-descobertos em dist/modules, nome camelCase).

## Contexto

A Fase 2 (cobrança MP com credencial de env) está entregue e auditada. A Fase 2b adiciona a
plataforma de onboarding do lojista no Admin Medusa (plano §800: wizard, CRUD de lojas/caixas via
API — required 3-4 do checklist oficial MP — e manuais). Piloto = Mercado Pago (modelo OAuth,
self-service de ponta a ponta); SumUp/Stone/Cielo entram na Fase 3 pelos mesmos moldes
(onboarding.md §11 t12). O provider de cobrança CONTINUA com credencial de env nesta fase
(plano §7.1: ordem 2 → 2b → 3; cutover do provider para token por lojista é decisão do 1.0.0).

## Comportamento entregue (spec do estado final)

1. **Módulo `posPayments`** (camelCase; auto-registro verificado no fonte) com 4 tabelas via
   migration knex própria: `pos_payments_connection` (acquirer único, status, action_reason,
   refs externas não-sensíveis, expires_at, last_validated_at, ator), `pos_payments_credential`
   (envelope cifrado + key_version), `pos_payments_oauth_state` (state único, expiração ≤10min,
   used_at, ator), `pos_payments_audit_event` (evento, ator, payload mínimo sem segredos).
   Serviço `MedusaService` com helpers tipados. Deploy roda `medusa db:migrate` (não executa no
   start — onboarding.md §5.2).

2. **Envelope AES-256-GCM** (`src/utils/crypto-envelope.ts`): formato
   `posp.v1.<keyVersion>.<iv>.<tag>.<ct>` (base64url); master key de
   `POS_PAYMENTS_MASTER_KEY` (hex 32B) + `POS_PAYMENTS_MASTER_KEY_PREVIOUS` para rotação dual-key
   (descripta com qualquer uma; nova gravação sempre na chave corrente). Fail-closed: sem keyset,
   criptografia/descriptografia levantam erro tipado. Zero dependências novas (node:crypto).

3. **Máquina de estados da conexão** (onboarding.md §4): `unconfigured → connecting → connected →
   {action_required|degraded|disconnected}` com transição única `transition(from,to)`,
   `assertNever` nos switches e teste por transição (barreira CONSTRAINTS 2 aplicada ao ciclo de
   vida da conexão). `action_required.reason` discriminada (`reauthorize`, `pairing`,
   `no_terminal`, `recipient_kyc`, `activation`).

4. **OAuth MP (piloto)**: `state` CSPRNG durável de uso único consumido atomicamente
   (UPDATE condicional `used_at IS NULL AND expires_at > now`); authorize_url
   `auth.mercadopago.com/authorization` (response_type=code, redirect_uri exata de config);
   callback público `GET /pos-payments/callback/:acquirer` valida state ANTES da troca, trata
   `error`, troca code em `POST /oauth/token` **urlencoded** (code 10min; `test_token=true` em
   teste), persiste tokens cifrados no ato, 302 → `/app/settings/pos-payments?connection=...&result=ok|error`.
   Refresh lazy single-flight com substituição ATÔMICA do par; `invalid_grant` →
   `action_required: reauthorize` + audit; NUNCA fallback para token de plataforma.

5. **Credencial colada (validate-then-activate)** + `/test`: `POST /connections/:acquirer`
   valida com chamada autenticada real (`GET /users/me` no MP) ANTES de ativar; falha = erro
   tipado e NADA persistido. `/test` revalida → connected/degraded.

6. **Ops de onboarding do adapter MP**: validateConnection, listTerminals (existente),
   setup PDV (`PATCH /terminals/v1/setup`), **stores CRUD** (§10.1: POST/GET search
   `/users/{user_id}/stores`) e **POS CRUD** (`POST /v2/pos` com X-Idempotency-Key obrigatório,
   GET `/v2/pos?external_id=`, PATCH/DELETE) — endpoints fixos https (SSRF: sem override).

7. **Rotas admin** (`/admin/pos-payments/*`, auth do core, sem authenticate próprio — ADR 0005):
   GET connections (resumo), GET/POST/DELETE connections/:acquirer (detail/colada/desconectar com
   purga + revogação onde há API), POST connections/:acquirer/start, POST connections/:acquirer/test,
   GET/POST stores, GET/POST/DELETE stores/pos (binding por external_id), POST terminals/:id/select
   (register_id opcional → binding {register, adquirente}→terminal espelhado em
   `store.metadata.pos.payments.registers`, merge depth-1; sem register_id = default global),
   GET/POST registers (idempotente). GET health estendido com resumo de conexões não-sensível.
   Auditoria nos eventos do §8 (connection.started/connected/validation_failed/reauthorized/
   degraded/disconnected/revoked, terminal.selected, credential.rotated, register.bound/unbound)
   com `req.auth_context.actor_id`.

8. **UI Admin**: rota `settings/pos-payments` (cards por adquirente com estado/rótulos pt-BR da
   máquina §4, botão Conectar (OAuth full-page), formulário credencial colada, Desconectar,
   tabela Terminais por caixa + binding, painel de lojas/POS MP) + widget `topbar` de setup com
   deep-link. Dados por `fetch` same-origin com cookie de sessão. `@medusajs/ui` como
   devDependency (justificativa ADR 0004 — UI da 2b; CONSTRAINTS 7).

9. **Segurança transversal**: redação (`code|state|token|authorization|pairing_code` nunca em
   logs/respostas); tokens nunca em respostas de API (regra MP); BOLA — rotas admin-only com ator
   auditado; callback sem auth protegido pelo state de uso único; erros ao operador sem detalhe
   interno.

10. **Erratas de código (COMMIT SEPARADO, primeiro)**: `service.ts` comentário "(CONSTRAINTS 5)"
    → "(CONSTRAINTS 8)" (renumber da barreira) + snippet de configuração MP no Getting Started do
    README.

## Fora de escopo (explícito)

Wizards SumUp/Stone/Cielo e painel de recebedores (Fase 3); provider lendo token por conexão
(cutover 1.0.0); chargebacks (§10.2 pós-v1); E2E OAuth com navegador humano — o aceite §9 com
autorização real fica como passo de validação assistida pós-merge (mesma natureza da RA1);
migrations NÃO rodam no start (documentado; deploy roda db:migrate).

## Acceptance Criteria (verificação por critério)

- AC1: keyset ausente → falha alta tipada (nunca grava plaintext). **Verificação**: spec
  `crypto-envelope.spec.ts` (roundtrip, tamper, rotação dual-key, fail-closed) + typecheck.
- AC2: state single-use/expira. **Verificação**: `oauth-state.spec.ts` (consume 2ª vez rejeita;
  expirado rejeita; binding de ator).
- AC3: transições inválidas rejeitadas; rótulos pt-BR por estado/reason. **Verificação**:
  `connection-state.spec.ts` (todas as transições válidas + rejeição das inválidas + assertNever).
- AC4: callback valida state antes da troca; error → redirect result=error sem vazar detalhe;
  troca urlencoded com credenciais de plataforma só no backend. **Verificação**: vitest
  `oauth-callback.spec.ts` — handler com fetch fake capturando corpo/headers do POST /oauth/token
  e asserindo redirect e ausência de segredo na resposta.
- AC5: refresh single-flight (2 concorrentes → 1 chamada), substituição atômica do par,
  invalid_grant → action_required:reauthorize + audit. **Verificação**: `oauth-refresh.spec.ts`.
- AC6: validate-then-activate — credencial inválida não persiste nada. **Verificação**: spec da
  rota POST connections com fetch fake 401 (assert: nenhum registro criado).
- AC7: desconectar purga credencial, mantém audit, espelho metadata → unconfigured. **Verificação**:
  spec da rota DELETE (assert de ausência do credential + presença do audit).
- AC8: stores/POS CRUD conforme §10.1 (X-Idempotency-Key no POST /v2/pos; external_id na busca).
  **Verificação**: `stores.spec.ts` do adapter (corpo/headers capturados por fetch fake).
- AC9: select/registers gravam binding em metadata com merge depth-1 (sem clobber do objeto pos
  inteiro) e auditam. **Verificação**: vitest `select-registers.spec.ts` — store.update fake
  asserindo o objeto mesclado depth-1 + linha de audit.
- AC10: health estendido sem segredos. **Verificação**: vitest `health.spec.ts` estendido —
  resumo de conexões sem nenhum campo de credencial na resposta.
- AC11: build do plugin (incl. admin) + typecheck + lint + cobertura global ≥90% verdes.
  **Verificação**: `pnpm typecheck && pnpm test:coverage && pnpm exec medusa plugin:build` no WSL;
  `pnpm ci:local` 14/14 antes do push.
- AC12: revisão adversarial SHIP (read-only, sobre o delta) antes do push; erratas em commit
  separado; evidências P0/P1/P5/P6 no ledger `.adlc/manifest.jsonl`. **Verificação**: comando
  `npx adversarial-review --base origin/develop` até exit 0 (SHIP) + `npx -y @adlc/cli
  gate-manifest verify` verde no CI.
