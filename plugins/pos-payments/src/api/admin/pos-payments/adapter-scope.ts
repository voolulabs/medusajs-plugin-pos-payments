/** Resolução do adapter das rotas admin — options do plugin (ADR 0005). */
import {
  ContainerRegistrationKeys,
  MedusaError,
} from "@medusajs/framework/utils"
import type { AuthenticatedMedusaRequest } from "@medusajs/framework"
import type { Logger } from "@medusajs/framework/types"
import type { PosPaymentsAdapter } from "../../../adapters/types"
import { resolveAdapter } from "../../../adapters"
import { getPluginOptions } from "../../../utils/plugin-options"

/**
 * Providers do módulo payment não são resolvíveis do container (verificado no
 * @medusajs/payment 2.19): as rotas falam com o adapter lido do bloco
 * `posTerminal` das options do plugin. manual/ausente → NOT_ALLOWED (400);
 * mercadopago sem accessToken → falha alta (CONSTRAINTS 4). O guard
 * MP_POINT_TEST_MODE (T6) é espelhado do provider: mesma postura nas duas
 * entradas de cobrança — e o estado "teste ativo" nunca é silencioso
 * (warn 1× por processo na primeira resolução; reset só para testes).
 */
let testModeWarned = false

export function resetTestModeWarn(): void {
  testModeWarned = false
}

export function adapterForRequest(
  req: AuthenticatedMedusaRequest
): PosPaymentsAdapter {
  const posTerminal = getPluginOptions(req.scope).posTerminal
  const acquirer = posTerminal?.acquirer ?? "manual"
  const options: Parameters<typeof resolveAdapter>[1] = {
    accessToken: posTerminal?.accessToken,
    testMode: posTerminal?.mpPointTestMode === true,
    ...(posTerminal?.fetchImpl ? { fetchImpl: posTerminal.fetchImpl } : {}),
  }
  const adapter = resolveAdapter(acquirer, options)
  if (!adapter) {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      `pos-payments: acquirer "${acquirer}" não expõe operações remotas de terminal`
    )
  }
  if (options.testMode && !testModeWarned) {
    testModeWarned = true
    const logger = req.scope.resolve(ContainerRegistrationKeys.LOGGER) as
      Logger | undefined
    logger?.warn(
      "pos-payments: MP_POINT_TEST_MODE ativo (posTerminal.mpPointTestMode) — terminais de sandbox (serial SBX*) aceitos; NUNCA usar em produção (mercado-pago.md §8)"
    )
  }
  return adapter
}
