import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework"
import { keyFor } from "../../../../providers/pos-terminal/service-mp-ops"
import { adapterForRequest } from "../adapter-scope"
import { createChargeSchema, parseOrThrow } from "../schemas"
import { toMedusaError } from "../errors"

/**
 * POST /admin/pos-payments/charges (§6.3): cria a cobrança na adquirente.
 * Idempotência determinística compartilhada com o provider (mesma derivação
 * do mpInitiate): replay do mesmo corpo devolve a MESMA ordem — dedup da
 * adquirente + reuse-guard de valor e terminal; corpo divergente falha alto.
 */
export async function POST(
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) {
  const body = parseOrThrow(createChargeSchema, req.body)
  const adapter = adapterForRequest(req)
  try {
    const { chargeId, view } = await adapter.createCharge(
      {
        amountMinor: body.amountMinor,
        externalReference: body.externalReference,
        terminalId: body.terminalId,
        ...(body.expirationTime !== undefined
          ? { expirationTime: body.expirationTime }
          : {}),
        ...(body.description !== undefined
          ? { description: body.description }
          : {}),
        ...(body.paymentMethodDefaultType !== undefined
          ? { paymentMethodDefaultType: body.paymentMethodDefaultType }
          : {}),
      },
      keyFor(body.externalReference, "charge")
    )
    res.json({ chargeId, ...view })
  } catch (error) {
    throw toMedusaError(error)
  }
}
