import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework"
import { adapterForRequest } from "../../adapter-scope"
import { assertChargeId } from "../../schemas"
import { toMedusaError } from "../../errors"

/**
 * GET /admin/pos-payments/charges/:id (§6.3): estado autoritativo na
 * adquirente — é por aqui que o POS polla (webhook só adianta o estado).
 */
export async function GET(
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) {
  const chargeId = assertChargeId(req.params.id)
  const adapter = adapterForRequest(req)
  try {
    res.json({ chargeId, ...(await adapter.getCharge(chargeId)) })
  } catch (error) {
    throw toMedusaError(error)
  }
}
