import { existsSync, readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

/**
 * O core descobre módulos de plugin npm pelo bare specifier
 * `<plugin>/.medusa/server/src/modules/<nome>` (medusa 2.x,
 * get-resolved-plugins.ts — MEDUSA_PLUGIN_SOURCE_PATH = ".medusa/server/src").
 * O exports map do pacote precisa resolver esse specifier SEM re-prefixar o
 * caminho: o padrão genérico `./*` dobra o prefixo e o loader falha com
 * MODULE_NOT_FOUND em caminho duplicado (achado no ensaio verdaccio de
 * 2026-10-10, `medusa db:migrate` no backend com o pacote instalado do
 * registry — providers não sofriam porque têm entry explícita).
 */

const pkgDir = join(__dirname, "..", "..")
const pkg = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8")) as {
  name: string
  exports: Record<string, unknown>
}

/** Target exato para o subpath, quando o exports tem entry literal. */
function matchExact(subpath: string): string | null {
  const value = pkg.exports[`./${subpath}`]
  return typeof value === "string" ? value : null
}

/** Prefixo do padrão wildcard (texto antes do `*`, sem o "./" inicial). */
function wildcardPrefix(key: string): string {
  return key.slice(2, key.indexOf("*"))
}

/** Target do wildcard mais específico que casa com o subpath. */
function matchWildcard(subpath: string): string | null {
  let best: { key: string; target: string } | null = null
  for (const [key, value] of Object.entries(pkg.exports)) {
    if (typeof value !== "string" || !key.includes("*")) continue
    const prefix = wildcardPrefix(key)
    if (!subpath.startsWith(prefix)) continue
    if (best && key.length <= best.key.length) continue
    best = { key, target: value.replace("*", subpath.slice(prefix.length)) }
  }
  return best?.target ?? null
}

/** Matching simplificado de subpath exports (exact + wildcard mais específico). */
function resolveSubpath(subpath: string): string | null {
  return matchExact(subpath) ?? matchWildcard(subpath)
}

const MODULE_SUBPATH = ".medusa/server/src/modules/posPayments"

describe("exports do pacote (discovery de módulos npm)", () => {
  it(`resolve o specifier de módulo do core (${pkg.name}/${MODULE_SUBPATH}) sem dobrar o prefixo`, () => {
    expect(resolveSubpath(MODULE_SUBPATH)).toBe(
      "./.medusa/server/src/modules/posPayments/index.js"
    )
  })

  it("o arquivo resolvido existe no build publicado", () => {
    const target = resolveSubpath(MODULE_SUBPATH)
    expect(target).toBeTruthy()
    if (!existsSync(join(pkgDir, ".medusa", "server"))) return
    expect(existsSync(join(pkgDir, target as string))).toBe(true)
  })

  it("o resolvedor real do Node resolve o specifier completo (self-reference)", () => {
    if (!existsSync(join(pkgDir, ".medusa", "server"))) return
    const nodeResolve = createRequire(__filename)
    const resolved = nodeResolve.resolve(`${pkg.name}/${MODULE_SUBPATH}`)
    expect(resolved).toBe(
      join(
        pkgDir,
        ".medusa",
        "server",
        "src",
        "modules",
        "posPayments",
        "index.js"
      )
    )
  })

  it("subpath de provider continua resolvendo (contrato da 0.0.1)", () => {
    expect(resolveSubpath("providers/pos-terminal")).toBe(
      "./.medusa/server/src/providers/pos-terminal/index.js"
    )
  })
})
