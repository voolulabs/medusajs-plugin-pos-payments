import { z } from "@medusajs/framework/zod"
import { MedusaError } from "@medusajs/framework/utils"

/**
 * Contrato do `data` da session (ADR 0002 §9): o módulo
 * payment faz merge/replay do `data` vindo do cliente — validação zod na
 * fronteira, uma vez só; record plano; chaves de prototype rejeitadas;
 * merge depth-1 com own-properties.
 */
const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"])

/**
 * Guard no input CRU, antes do zod reconstruir o record (zod silencia chaves
 * de prototype ao reassinar; a fronteira exige REJEITAR, não descartar).
 */
export function assertSafeSessionKeys(
  data: Record<string, unknown> | undefined
): void {
  const forbidden = Object.keys(data ?? {}).filter((k) => FORBIDDEN_KEYS.has(k))
  if (forbidden.length) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `chave proibida no data: ${forbidden.join(", ")}`
    )
  }
}

export const posTerminalSessionSchema = z
  .record(z.string(), z.unknown())
  .superRefine((data, ctx) => {
    for (const key of Object.keys(data)) {
      if (FORBIDDEN_KEYS.has(key)) {
        ctx.addIssue({
          code: "custom",
          message: `chave proibida no data: ${key}`,
        })
      }
    }
  })

export type PosTerminalSessionData = z.infer<typeof posTerminalSessionSchema>

export function mergeSessionData(
  base: Record<string, unknown> | undefined,
  patch: Record<string, unknown> | undefined
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(base ?? {})) out[k] = v
  for (const [k, v] of Object.entries(patch ?? {})) out[k] = v
  return out
}
