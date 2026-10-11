#!/usr/bin/env bash
# ci:local — paridade de CI em dev (ticket T7) + SAST local (ticket T8).
# Fonte da verdade: .github/workflows/ci.yml
# Regra de casa: nenhum erro pode ser descoberto pelo CI — todo gate roda aqui antes do push,
# na MESMA ordem do job `verify` + o job `commitlint`. Serviços com secret (Codecov, FOSSA,
# Snyk) são SKIP declarado no fim, nunca falha silenciosa. Qualquer mudança no ci.yml passa
# por aqui no mesmo PR. Estágios 12–13 (shellcheck, semgrep) são defesa local DECLARADA
# acima do ci.yml — checagem mecânica das classes CWE que só apareciam em revisão.
# ATENÇÃO: run_stage chama os estágios dentro de `if !` — dentro de função assim o set -e
# fica SUSPENSO. Todo comando que pode falhar precisa de `|| return 1` explícito.
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"
[ -d "$HOME/.volta/bin" ] && export PATH="$HOME/.volta/bin:$PATH"

require_cli() {
  local cli="$1"
  local package="$2"
  local expected="${3:-}"
  if ! command -v "$cli" >/dev/null 2>&1; then
    echo "CLI ausente: instale $package antes de rodar ci:local." >&2
    exit 1
  fi
  # Presença não basta: versão diferente da pinada pelo CI destrói a paridade
  # (um verde local deixa de garantir o verde do CI). Token extraído e
  # comparado por IGUALDADE — substring/regex aceitariam 10.3.3 como 0.3.3.
  if [ -n "$expected" ]; then
    local found_token
    found_token="$("$cli" --version 2>/dev/null | grep -oE "[0-9]+(\.[0-9]+)+([-.][0-9A-Za-z]+)*" | head -1)"
    if [ "$found_token" != "$expected" ]; then
      echo "Versão de $cli diverge do pin do CI (esperado $expected; encontrado ${found_token:-desconhecida})." >&2
      exit 1
    fi
  fi
}
require_cli opcore "@the-open-engine-company/opcore@0.3.3 (npm i -g)" "0.3.3"
require_cli adlc "@adlc/cli@1.11.1 (npm i -g --ignore-scripts)" "1.11.1"
# O CI usa corepack prepare pnpm@9.10.0 (packageManager do repo). Com corepack
# disponível, TODO pnpm daqui passa pelo pin do repo; sem corepack, exige a
# versão exata no PATH.
if command -v corepack >/dev/null 2>&1; then
  pnpm() { command corepack pnpm "$@"; }
  export -f pnpm
else
  require_cli pnpm "pnpm@9.10.0 (corepack enable)" "9.10.0"
fi

SKIPS=()
STAGES_OK=0

run_stage() {
  local name="$1"
  shift
  printf '\n==> [%s]\n' "$name"
  if ! "$@"; then
    printf '\nERRO: estágio "%s" falhou — corrija antes de push.\n' "$name" >&2
    exit 1
  fi
  STAGES_OK=$((STAGES_OK + 1))
}

stage_tree() {
  if [ -n "$(git status --porcelain)" ]; then
    echo "working tree suja — o CI constrói código commitado; commit ou stash antes."
    return 1
  fi
}

stage_adlc() {
  if [ -f .adlc/manifest.jsonl ] && [ ! -f "$HOME/.adlc/manifest.key" ]; then
    echo "ledger .adlc/manifest.jsonl existe sem ~/.adlc/manifest.key — o record gravaria unsigned e o CI quebraria (chain broken)."
    return 1
  fi
  if [ -f "$HOME/.adlc/manifest.key" ]; then
    # SC2155 + set -e suspenso (função chamada por `if !`): a falha do cat NÃO
    # pode exportar chave vazia — o verify local sem chave aceita em silêncio
    # (r1 do CodeRabbit no T8). Arquivo existente porém VAZIO é o mesmo furo.
    ADLC_MANIFEST_KEY="$(cat "$HOME/.adlc/manifest.key")" || return 1
    if [ -z "$ADLC_MANIFEST_KEY" ]; then
      echo "$HOME/.adlc/manifest.key vazio — sem chave o record gravaria unsigned e o verify local aceita em silêncio." >&2
      return 1
    fi
    export ADLC_MANIFEST_KEY
  fi
  adlc spec-lint .adlc/specs/fase-1-provider-manual.md || return 1
  adlc gate-manifest verify --json || return 1
}

stage_gitleaks() {
  local version="8.30.1"
  local checksum="551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb"
  # Cache PRIVADO do usuário (/tmp é plantável por outro usuário local — CWE-829);
  # o que fica em cache é o TARBALL — o binário é extraído a cada execução a
  # partir dele, então só roda código cujo checksum bate (CWE-354).
  local cache="${XDG_CACHE_HOME:-$HOME/.cache}/gitleaks"
  local tgz="$cache/gitleaks-$version.tgz"
  case "$(uname -s)-$(uname -m)" in
    Linux-x86_64) ;;
    *)
      SKIPS+=("gitleaks (plataforma $(uname -s)-$(uname -m) sem binário pinado — rode no CI)")
      return 0
      ;;
  esac
  if [ ! -f "$tgz" ]; then
    mkdir -p "$cache"
    curl -sSfL "https://github.com/gitleaks/gitleaks/releases/download/v${version}/gitleaks_${version}_linux_x64.tar.gz" \
      -o "$tgz" || return 1
  fi
  echo "${checksum}  $tgz" | sha256sum -c - >/dev/null || {
    rm -f "$tgz"
    echo "checksum do tarball do gitleaks não bateu — cache descartado, rode de novo para baixar limpo." >&2
    return 1
  }
  local rundir
  rundir="$(mktemp -d)"
  local status=0
  tar -xzf "$tgz" -C "$rundir" gitleaks || {
    rm -rf "$rundir"
    return 1
  }
  # PRESERVA o status do scanner: gitleaks exit 1 = VAZAMENTO encontrado —
  # o cleanup depois dele não pode mascarar o gate (provado na r4 da revisão).
  "$rundir/gitleaks" detect --source . --no-banner --redact -v || status=$?
  rm -rf "$rundir"
  return "$status"
}

stage_commitlint() {
  local branch
  branch="$(git branch --show-current)"
  case "$branch" in
    develop | main | "")
      SKIPS+=("commitlint (branch $branch — job é só de PR)")
      return 0
      ;;
  esac
  local base="${CI_LOCAL_BASE:-origin/develop}"
  # set -e fica suspenso dentro de função chamada por `if` — substituição de
  # comando quebrada silenciava o range e o commitlint validava outra coisa
  # (provado por mutation). Checagem explícita em cada passo que pode falhar.
  if [[ "$base" == origin/* ]]; then
    if ! git fetch origin "${base#origin/}" --quiet; then
      echo "git fetch ${base} falhou — commitlint exige a base atualizada (offline: aponte CI_LOCAL_BASE para um ref local)." >&2
      return 1
    fi
  fi
  local from
  if ! from="$(git merge-base "$base" HEAD 2>/dev/null)"; then
    echo "merge-base falhou para $base — ref inexistente? Confira CI_LOCAL_BASE." >&2
    return 1
  fi
  printf 'validando %s..HEAD (%s)\n' "$from" "$branch"
  npx --yes -p @commitlint/cli@21 -p @commitlint/config-conventional@21 \
    commitlint --from "$from" --to HEAD
}

stage_shellcheck() {
  local version="0.10.0"
  local checksum="6c881ab0698e4e6ea235245f22832860544f17ba386442fe7e9d629f8cbedf87"
  # Mesmo padrão do gitleaks: o TARBALL fica em cache PRIVADO do usuário
  # (/tmp é plantável por outro usuário local — CWE-829), o checksum é
  # verificado A CADA execução e o binário só roda se extraído desse tarball
  # verificado (CWE-354).
  local cache="${XDG_CACHE_HOME:-$HOME/.cache}/ci-local"
  local tarball="$cache/shellcheck-v$version.tar.xz"
  case "$(uname -s)-$(uname -m)" in
    Linux-x86_64) ;;
    *)
      SKIPS+=("shellcheck (plataforma $(uname -s)-$(uname -m) sem binário pinado — rode no CI)")
      return 0
      ;;
  esac
  if [ ! -f "$tarball" ]; then
    mkdir -p "$cache"
    curl -sSfL "https://github.com/koalaman/shellcheck/releases/download/v${version}/shellcheck-v${version}.linux.x86_64.tar.xz" \
      -o "$tarball" || return 1
  fi
  echo "${checksum}  $tarball" | sha256sum -c - >/dev/null || {
    rm -f "$tarball"
    echo "checksum do tarball do shellcheck não bateu — cache descartado, rode de novo para baixar limpo." >&2
    return 1
  }
  local rundir
  rundir="$(mktemp -d)"
  local status=0
  tar -xf "$tarball" -C "$rundir" || {
    rm -rf "$rundir"
    return 1
  }
  # PRESERVA o status do scanner: shellcheck exit 1 = defeito encontrado — o
  # cleanup não pode mascarar o gate (mesma lição do gitleaks, provada por mutation).
  "$rundir/shellcheck-v${version}/shellcheck" -x scripts/*.sh || status=$?
  rm -rf "$rundir"
  return "$status"
}

stage_semgrep() {
  local version="1.179.0"
  # Bootstrap único em cache PRIVADO: venv sem ensurepip (ubuntu sem
  # python3-venv) + pip oficial (bootstrap.pypa.io) + semgrep com versão PINADA
  # do PyPI. Em execução a versão é conferida por token exato, como os outros CLIs.
  local cache="${XDG_CACHE_HOME:-$HOME/.cache}/ci-local"
  local venv="$cache/semgrep-venv"
  local bin="$venv/bin/semgrep"
  if [ ! -x "$bin" ]; then
    echo "semgrep $version ausente — bootstrap único em $cache (venv + PyPI)..." >&2
    mkdir -p "$cache"
    python3 -m venv --without-pip "$venv" || return 1
    local getpip
    getpip="$(mktemp)"
    curl -sSfL https://bootstrap.pypa.io/get-pip.py -o "$getpip" || {
      rm -f "$getpip"
      return 1
    }
    "$venv/bin/python" "$getpip" --quiet || {
      rm -f "$getpip"
      return 1
    }
    rm -f "$getpip"
    "$venv/bin/pip" install --quiet "semgrep==$version" || return 1
  fi
  local found
  found="$("$bin" --version 2>/dev/null | grep -oE "[0-9]+(\.[0-9]+)+" | head -1)"
  if [ "$found" != "$version" ]; then
    echo "Versão do semgrep diverge do pin (esperado $version; encontrado ${found:-desconhecida}) — remova $venv e rode de novo." >&2
    return 1
  fi
  # --error é load-bearing: sem ele semgrep acha e sai 0 (provado no smoke).
  # Excludes de artefatos de build; regras vêm do registry com metrics off.
  "$bin" scan \
    --config p/security-audit --config p/secrets \
    --metrics=off --error --quiet \
    --exclude ".medusa" --exclude "node_modules" --exclude "dist" \
    . || return 1
}

printf 'ci:local — paridade do .github/workflows/ci.yml (base: %s)\n' "${CI_LOCAL_BASE:-origin/develop}"

run_stage "0 árvore limpa" stage_tree
run_stage "1 install (frozen)" pnpm install --frozen-lockfile
run_stage "2 lint + formato" bash -c 'pnpm lint && pnpm format:check'
run_stage "3 build (medusa plugin:build)" bash -c 'cd plugins/pos-payments && pnpm exec medusa plugin:build'
run_stage "4 testes + cobertura (90/95)" bash -c 'cd plugins/pos-payments && pnpm test:coverage'
run_stage "5 typecheck (tsc --noEmit)" bash -c 'cd plugins/pos-payments && pnpm exec tsc --noEmit'
run_stage "6 knip" pnpm knip
run_stage "7 opcore" bash -c 'OPCORE_NO_HOOKS=1 opcore check --repo . --all'
run_stage "8 adlc (spec-lint + manifest)" stage_adlc
run_stage "9 npm audit (prod, high)" pnpm audit --prod --audit-level high
run_stage "10 gitleaks" stage_gitleaks
run_stage "11 commitlint (range da branch)" stage_commitlint
run_stage "12 shellcheck (bash estático)" stage_shellcheck
run_stage "13 semgrep (SAST: security-audit + secrets)" stage_semgrep

printf '\nCI LOCAL: %s/14 estágios verdes.\n' "$STAGES_OK"
if [ "${#SKIPS[@]}" -gt 0 ]; then
  printf 'SKIP declarado:\n'
  printf '  - %s\n' "${SKIPS[@]}"
fi
printf 'Serviços com secret sempre fora daqui: Codecov (upload), FOSSA (licenças), Snyk (SAST/deps).\n'
printf 'Defesa local declarada: 12 shellcheck + 13 semgrep — acima do ci.yml (ticket T8).\n'
