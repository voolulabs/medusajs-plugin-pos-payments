module.exports = {
  extends: ["@commitlint/config-conventional"],
  // commits de bots de badge não seguem conventional e não passam por review
  // (único do repo: fossabot) — isentos pela assinatura no corpo; commit
  // humano continua sujeito à lei inteira (ADR 0006 §2)
  ignores: [(commit) => /signed off by: fossabot\b/i.test(commit)],
  rules: {
    "header-max-length": [2, "always", 100],
    // corpo em PT-BR com caminhos/refs estoura 100 com frequencia
    "body-max-line-length": [2, "always", 200],
  },
}
