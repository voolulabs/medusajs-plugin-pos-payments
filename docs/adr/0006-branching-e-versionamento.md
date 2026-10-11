# ADR 0006 — Branching e versionamento (plugin pos-payments e repos da família)

- **Status:** Aceito
- **Data:** 2026-09-27
- **Escopo:** novo repo `@voolulabs/medusajs-plugin-pos-payments` (Fase 1) e alinhamento com
  `medusa-pos`, `store-b2c-boilerplate` e `medusa-plugins`.

## Contexto

A família já opera um modelo de facto: **branching por ambiente** (`develop → staging → main`, "never skip steps"), publicação disparada por **tag `v*` na main** (workflow npm com `NPM_TOKEN`), bumps explícitos `chore(release): vX.Y.Z` e tags `v0.x.y`. Commits são *estilo* Conventional, porém **não
enforçados** (histórico tem `docs:` e `Docs:` misturados). O core Medusa usa **changesets**
(monorepo); o boilerplate next-enterprise embute **semantic-release** (não usado); o
`store-b2c-boilerplate` segue o upstream FUNKYTON (`master` + `staging`, sem tags). No
ecossistema, plugins convivem com minors rápidas do Medusa (2.19 → 2.21): o plugin oficial SumUp
usa peer `^2.15.5`; plugin comunitário pinado em `2.12.4` quebrou a compatibilidade — anti-padrão.
Regras de release já fixadas na família: semver aplicado à superfície (exports,
provider id/options, payload de webhook, faixas de peerDep), Keep-a-Changelog, provenance +
`npm audit signatures`.

## Decisões

1. **Branching = modelo da casa, estendido ao repo novo** (igual a `medusa-plugins`):
   `develop → staging → main`, apenas essas três longevas; features curtas `feat/*`, `fix/*`
   nascem de `develop` e entram **só por PR**. Release = `develop → staging → main` + **tag
   `v*` na main** dispara o publish (nunca tag em develop). `staging` alimenta o ambiente de
   homologação — enquanto ele não existe, a branch fica provisionada porém dormente, e a
   semântica de ambiente é carregada pelas dist-tags do npm (`next` = homologação,
   `latest` = produção); `main`, a produção.
2. **Conventional Commits enforçados por CI** (commitlint no push/PR), com scopes dos adapters
   (`feat(mercadopago):`, `fix(cielo):`) — resolve a inconsistência do histórico sem mudar o
   mecanismo de release da casa. Exceção única, posta por evidência: commits de bots de badge
   (`fossabot`, assinados no corpo) são isentos — não seguem conventional e não passam por
   review; o gate mordeu de verdade no PR de promoção #20 antes da isenção entrar.
3. **Versionamento = bump manual em PR `chore(release): vX.Y.Z` + tag `v*` → publish com
   aprovação humana (staged publishing).** A tag dispara `npm stage publish` (`--provenance`,
   dist-tag `latest`/`next` derivado da versão); a versão fica em **stage** e só vai ao ar com
   **approve de um mantenedor com 2FA** (aba "Staged Packages" do npmjs.com ou
   `npm stage approve <id> --otp`). Requer npm ≥11.15/Node ≥22.14 no runner; o npm remove o
   publish direto por token em janeiro de 2027 — errata 2026-09-30.
   **Errata 2026-10-01 — bootstrap da estreia:** a doc do npm
   ([staged-publishing](https://docs.npmjs.com/staged-publishing), verificada em 2026-10-01)
   permite stage de **pacote novo** ("You can use staged publishing for both new and existing
   packages"), com placeholder público `0.0.0-stage` até o approve do mantenedor. O run de tag
   da `v0.0.1` falhou mesmo assim com **E404** no `/-/stage/package/` — causa não isolada
   (hipóteses: token de CI granular stage-only sem permissão de publicar pacote novo; npm do
   runner < 11.15). Versão anterior desta errata atribuía à doc a frase "you cannot stage a
   brand-new package" — **não consta na página atual**. A estreia foi concluída com publish
   direto **local**, com OTP do mantenedor (placeholder `0.0.0-stage.0` sob dist-tag `next`,
   deprecado logo após o approve da versão real). **Gatilho:** provar stage-from-zero (pacote
   novo) com o token de CI antes de confiar o fluxo; da segunda versão em diante o stage-only
   vale integral.
   Sem semantic-release e sem changesets: repo **single-package** não justifica changesets
   (ferramenta de monorepo — adotar só se o fatiamento do monorepo acontecer), e o
   semantic-release do boilerplate conflita com o fluxo tag-triggered da casa. O workflow de
   publish **só roda se a tag bate com o `version` do package.json** e publica com
   `--provenance` a partir da `main`. CHANGELOG em Keep-a-Changelog, gerado dos commits
   convencionais (git-cliff) a partir da `0.1.0`.

   **Errata 2026-10-10 — CHANGELOG curado à mão (git-cliff não adotado):** o git-cliff
   prometido acima não entrou na `0.1.0`. As release notes da casa são curadas à mão
   (Keep-a-Changelog, agrupadas por feature — o bullet do adapter T1–T5 cobre 4 PRs;
   lista derivada de commits seria ruído). O procedimento de bump está no CLAUDE.md
   ("Release e versionamento"). Revisitar se a cadência de release justificar geração
   automática.
4. **SemVer do plugin — contrato de 1.0.0:** durante o piloto privado (Fases 1–2) fica em
   **`0.x`** — breaking pode entrar em MINOR (semver §4) e o backend consome **versão exata**
   (em `0.x`, caret só pega patch). **`1.0.0` congela o contrato público** (gatilho: primeiro
   lojista em produção): a partir daí quebrar exports, provider id/options, payload de webhook,
   rotas ou faixa de peerDep = MAJOR. **Âncoras de versão (errata
   2026-09-30):** `0.0.1` = camada base manual; `0.1.0` = primeiro adapter (Mercado Pago) em
   sandbox; `0.2.0` = onboarding/OAuth/Admin (primeiras migrations); um MINOR por adapter na

   **Errata 2026-10-10 — ancoradouro da Fase 2b:** o `0.2.0` reservado acima para
   onboarding/OAuth/Admin (primeiras migrations) foi consumido pela `0.1.0` — a Fase 2b
   embarcou junto com o adapter MP na mesma release (o `0.1.0` nunca chegou ao registry;
   número livre). `0.2.0+` = próximos MINORs (um por adapter da Fase 3 ou pós-1.0.0).
   Fase 3. **Critérios de prontidão do `1.0.0`** (além do gatilho de negócio): (1) ≥1 adapter
   com transação real completa (charge+refund); (2) auditoria do contrato público documentada;
   (3) blob `data` da session com `data_version` e política de migração de blobs antigos;
   (4) upgrade real de instância com dados via `medusa db:migrate` testado; (5) matriz de
   minors do Medusa documentada; (6) política de deprecação/backport publicada. O congelamento
   **não** exige todos os adapters — a camada base congela com o adapter piloto certificado;
   os demais entram como MINOR. Options de adapter são superfície pública: **aditivas por
   design**.
5. **Compatibilidade Medusa = política de versão:** peer range **`>=2.15 <3`**; a matriz de CI
   roda contra as minors suportadas (a que produzimos + a última 2.2x). **Dropar uma minor do
   range = MINOR; suportada e quebrada = MAJOR.** Nunca peer pinado exato (anti-padrão
   `2.12.4`).
6. **Prereleases:** `-rc.N` publicados pelo **mesmo fluxo da estável** — tag `v*` na `main` (o
   guard do publish só aceita tag ancestral de `main`; errata 2026-09-30: não existe caminho de
   publish a partir da `staging`). Dist-tag derivado da versão no workflow: prerelease →
   **`next`**; estável → `latest`. Backend de homologação consome `next`; produção, `latest`.
7. **Versionamento independente por repo:** plugin (`@voolulabs/*`) e app (`medusa-pos`) não
   sincronizam números — a compatibilidade app ↔ plugin ↔ Medusa é documentada em matriz própria,
   não acoplada por versionamento. `store-b2c-boilerplate` segue o upstream (master+staging,
   sem semver próprio) enquanto o boilerplate comandar.
8. **Gate de release da família: o E2E.** A publicação estável (`latest`) exige o E2E de vendas
   (`scripts/e2e-pos.mjs`) verde contra um backend real executando a versão candidata. A candidata
   chega ao backend antes da estável por um dos caminhos: prerelease `-rc.N` no dist-tag `next`
   (§6) ou registry local de ensaio (Verdaccio no dev) enquanto a homologação não existe. O
   script vive no backend e é o teste de contrato da família; o procedimento de release do
   backend o lista como passo obrigatório. **Ciclo operacional:** rc `-rc.N` (`next`) →
   homologação na versão exata → E2E + integração de adquirente em staging → estável (`latest`)
   → produção; a branch `staging` é a janela de curadoria da release, o isolamento prod×candidata
   é dos artefatos (`next`/`latest` + versão exata).

## Consequências

- Zero ferramental novo na Fase 1 além do workflow de publish: mesmos mecanismos do fluxo da
  casa (publish por tag) + um job commitlint; git-cliff não entrou na `0.1.0`
  (errata 2026-10-10 na decisão 3 — CHANGELOG curado à mão).
- Durante `0.x`, atualizar o plugin no backend é ato deliberado (versão exata) — custo aceito
  no piloto, revertido no 1.0 com faixa `^1.x`.
- A matriz de minors do Medusa no CI é a materialização da faixa de peer: se a matriz crescer
  demais, dropar a minor mais antiga é MINOR (anunciar no CHANGELOG).
- Prerelease `next` cria o hábito de homologar a staging com o pacote que será publicado —
  fecha o risco do postBuild/tarball (o backend consome o plugin sempre do registry).

## Referências

- ADR 0001 (pin de SDKs) · ADR 0002 (superfície semver e reuso) · ADR 0005 (superfícies de API)
- [Conventional Commits](https://www.conventionalcommits.org/) ·
  [semver §4 (0.x)](https://semver.org/) ·
  [npm dist-tags](https://docs.npmjs.com/adding-dist-tags-to-packages/) ·
  Medusa core: `.changeset/` (v2.19.0 — referência de monorepo, não adotado)
