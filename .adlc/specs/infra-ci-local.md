# Spec: Infra — paridade de CI em dev (`pnpm ci:local`)

Extraída para o gate P1 do ADLC (ticket `T7`). Fonte: `.github/workflows/ci.yml`
(jobs `verify` e `commitlint` — sequência e comandos copiados verbatim) e os
deslizes do ciclo T5 que motivam o ticket: commitlint (subject sentence-case,
corpo >200), ledger sem assinatura e achados do revisor que a bateria local não
pegou. Regra de casa: **nenhum erro pode ser descoberto pelo CI** — todo gate do
CI roda localmente antes do push, na mesma ordem.

## 1. Escopo do ticket

- `scripts/ci-local.sh` — o executor, um estágio por gate do CI, `set -euo pipefail`.
- `package.json` — script `"ci:local": "bash scripts/ci-local.sh"`.

Fora de escopo: serviços com secret (Codecov, FOSSA, Snyk — **SKIP declarado**
com motivo, não falha); mudanças nos workflows do CI; hooks de git (pre-push é
fase 2 deste ticket, se aprovado).

## 2. Mapa de estágios (ordem = ordem do ci.yml)

| # | Estágio | Comando local | Gate do CI |
|---|---|---|---|
| 0 | árvore limpa | `git status --porcelain` vazio | (checkout de código commitado) |
| 1 | install | `pnpm install --frozen-lockfile` | Install (frozen) |
| 2 | lint + formato | `pnpm lint && pnpm format:check` | Lint (ESLint Medusa + Prettier) |
| 3 | build | `pnpm exec medusa plugin:build` (plugins/pos-payments) | Build |
| 4 | testes + cobertura | `pnpm test:coverage` (plugins/pos-payments) | Unit tests (thresholds 90/95) |
| 5 | typecheck | `pnpm exec tsc --noEmit` (plugins/pos-payments) | Typecheck (strict) |
| 6 | knip | `pnpm knip` | Knip |
| 7 | opcore | `OPCORE_NO_HOOKS=1 opcore check --repo . --all` | Opcore |
| 8 | adlc | `spec-lint` da spec da fase 1 + `gate-manifest verify --json` com `ADLC_MANIFEST_KEY` (~/.adlc/manifest.key) | ADLC |
| 9 | audit | `pnpm audit --prod --audit-level high` | npm audit |
| 10 | gitleaks | binário pinado v8.30.1 com checksum verificado (cache em /tmp), `detect --source . --no-banner --redact -v` | Gitleaks |
| 11 | commitlint | `commitlint --from merge-base(CI_LOCAL_BASE, HEAD) --to HEAD` com @commitlint/cli@21 + config-conventional@21 (pin = CI); base padrão `origin/develop`, override `CI_LOCAL_BASE` | job commitlint |
| — | codecov / fossa / snyk | **SKIP** com motivo (serviço com secret) | Upload/FOSSA/Snyk |

## 3. Contrato do executor

- Falha rápida: o primeiro estágio vermelho aborta com o NOME do estágio e exit
  não-zero; a saída lista os skips no fim (paridade declarada, nunca silenciosa).
- Caminhos independentes de cwd (`git rev-parse --show-toplevel`); PATH do volta
  acrescentado se existir.
- Commitlint só roda em branch de trabalho (não roda em `develop`/`main`).
- Nenhuma dependência nova: os CLIs pinados (@commitlint/*, gitleaks) vêm por
  `npx --yes -p pkg@versão` / download com checksum, como no CI.

## Acceptance criteria (cada uma com verify)

1. MUST replicar os estágios na ordem do ci.yml, com saída por estágio e exit 0
   quando tudo verde — verify: `pnpm ci:local` verde na própria branch do ticket
   (dogfood).
2. MUST abortar no primeiro estágio vermelho apontando o nome dele — verify:
   mutação proposital quebrando um estágio e o script abortando com o nome.
3. MUST recusar working tree suja (estágio 0, exit 1) — verify: arquivo não
   commitado na árvore.
4. MUST declarar os skips (Codecov/FOSSA/Snyk) com motivo, sem falhar — verify:
   saída do `pnpm ci:local`.
5. MUST commitlint cobrir merge-base(origin/develop, HEAD)..HEAD, override por
   `CI_LOCAL_BASE` — verify: estágio 11 na branch do ticket.
6. MUST os gates novos para o dev loop (`tsc --noEmit`, `audit --prod`,
   gitleaks) passarem na base atual — verify: dogfood do estágio 5, 9 e 10.
7. SHOULD gitleaks cacheado (2ª execução não baixa de novo) — verify: execução
   repetida.
