# Spec: Infra — SAST local no `ci:local` (shellcheck + semgrep)

Extraída para o gate P1 do ADLC (ticket `T8`). Fonte: as rodadas T5+T7 — as
classes de defeito de segurança mais graves (CWE-829 cache em `/tmp`, CWE-354
binário de artefato sem checksum, status de scanner mascarado por cleanup,
segredo em código) chegaram **por revisão humana/CodeRabbit, depois do código
pronto**. A checagem mecânica dessas classes tem que rodar em dev, antes do
push, no mesmo `ci:local` — revisor não é gate.

## 1. Escopo do ticket

- `scripts/ci-local.sh` — dois estágios novos (12 shellcheck, 13 semgrep) +
  fix SC2155 no `stage_adlc` (export embutido mascara a falha do `cat` —
  achado real do shellcheck na arvore base).
- `.adlc/lessons/` — defesas do P7 (`lesson-foundry`) minerando T5+T7.
- `package.json` — sem mudança (o script `ci:local` já existe).

Fora de escopo: `.github/workflows/` (o CI não muda neste ticket), hooks de
git, novas regras semgrep custom.

## 2. Estágios novos (extensão declarada da tabela do T7)

| # | Estágio | Comando local | Relação com o CI |
|---|---|---|---|
| 12 | shellcheck | binário pinado **v0.10.0**, sha256 `6c881ab0698e4e6ea235245f22832860544f17ba386442fe7e9d629f8cbedf87` (tarball oficial koalaman/shellcheck, hash capturado por TLS em 2026-10-04), `shellcheck -x scripts/*.sh` | **acima do ci.yml** — defesa local declarada |
| 13 | semgrep | venv pinado em `~/.cache/ci-local/semgrep-venv`, **semgrep 1.179.0** (PyPI, 2026-10-04), `scan --config p/security-audit --config p/secrets --metrics=off --error --quiet` com excludes `.medusa`/`node_modules`/`dist` | **acima do ci.yml** — defesa local declarada |

Contrato das provisões (mesmo padrão do gitleaks do T7):

- O cache guarda o **artefato pinado** em diretório privado do usuário
  (`${XDG_CACHE_HOME:-$HOME/.cache}/ci-local` — nunca `/tmp`, CWE-829).
- Checksum do tarball do shellcheck verificado **a cada execução** (CWE-354);
  hash divergente descarta o cache e falha.
- Semgrep: venv sem ensurepip (Ubuntu sem `python3-venv`) + `get-pip.py`
  oficial + `pip install semgrep==1.179.0`; versão conferida por **token
  exato** na execução (mesma lição do `require_cli` — substring aceitaria
  1.17.9 como 1.179.0). `--metrics=off` (sem telemetria).
- Status do scanner preservado pelo cleanup (`|| status=$?` antes do
  `rm -rf` — mesmo defeito da r4 do #49 não se repete).
- Bootstrap falha alto com instrução; nada baixa silenciosamente fora do
  padrão documentado aqui.
- `--error` no semgrep é load-bearing: sem ele o scan **acha e sai 0**
  (provado no smoke de 2026-10-04).

Baseline medido em 2026-10-04: scan dos dois rulesets no repo inteiro = **zero
achados** (exit 0 com `--error`); shellcheck na árvore base = 1 achado
(SC2155), corrigido neste ticket. O estágio entra verde sem triagem pendente.

## 3. P5/P7 institucionalizados neste ticket

- P5 pelo livro: `adlc hollow-test` sobre o diff (bash está fora do escopo de
  mutação JS/TS da ferramenta — a prova dos estágios novos é **por mutação
  manual documentada**), `adlc review-calibration`, e
  `adlc prosecute --input passes.json --ticket T8` com evidência no manifest
  assinado.
- P7: `adlc lesson-foundry --prompt-only` minerando as rodadas T5+T7 em
  defesas deterministicas em `.adlc/lessons/`.

## Acceptance criteria (cada uma com verify)

1. MUST shellcheck verificar `scripts/*.sh` como estágio do `ci:local`, versão
   pinada com checksum verificado a cada execução em cache privado — verify:
   mutação proposital com defeito de bash conhecido faz o estágio falhar;
   árvore sana passa com a versão pinada.
2. MUST semgrep varrer o repo com `p/security-audit` + `p/secrets`
   (metrics off, artefatos de build excluídos), versão pinada — verify:
   mutação proposital com padrão CWE conhecido (segredo hardcoded) faz o
   estágio falhar; árvore sana passa.
3. MUST o status do scanner sobreviver ao cleanup e o resumo refletir a
   contagem nova de estágios — verify: `pnpm ci:local` completo verde com
   contagem certa; com defeito plantado, o script aborta no estágio certo com
   exit 1.
4. MUST P5 pelo livro gravado no manifest: hollow-test sobre o diff do ticket,
   review-calibration e `adlc prosecute --input passes.json --ticket T8` com
   chave — verify: `adlc gate-manifest show` lista os registros do T8
   assinados.
5. MUST P7 `lesson-foundry --prompt-only` produzir defesas deterministicas em
   `.adlc/lessons/` minerando as rodadas T5+T7 — verify: arquivos de lição
   novos, acionáveis e com proveniência das rodadas de origem.
6. SHOULD achados pre-existentes do semgrep serem triados antes do estágio
   entrar — verify: baseline medido (zero achados em 2026-10-04) e o único
   achado do shellcheck (SC2155) corrigido neste ticket.
