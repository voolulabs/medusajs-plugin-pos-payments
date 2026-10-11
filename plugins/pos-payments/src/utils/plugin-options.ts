import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import type { MedusaRequest } from "@medusajs/framework"
import type { PosPaymentsPluginOptions } from "../types"

type Scope = MedusaRequest["scope"]

/** Fonte única do nome do pacote: o resolve no array `plugins` e a factory do
 * src/index.ts derivam daqui — renomear o pacote não pode quebrar em silêncio. */
export const PLUGIN_NAME = "@voolulabs/medusajs-plugin-pos-payments"

/**
 * Lê as options do plugin do config module resolvido (ADR 0002 §5 — padrão
 * getPluginOptions do narisolutions). Funciona nas formas factory e objeto
 * do medusa-config: ambas terminam em `configModule.plugins` com as options.
 */
export function getPluginOptions(scope: Scope): PosPaymentsPluginOptions {
  const configModule = scope.resolve(ContainerRegistrationKeys.CONFIG_MODULE)

  const entry = (configModule?.plugins ?? []).find(
    (p: string | { resolve: string }) =>
      (typeof p === "string" ? p : p.resolve) === PLUGIN_NAME
  )

  return (
    (typeof entry === "object"
      ? (entry.options as PosPaymentsPluginOptions)
      : undefined) ?? {}
  )
}
