import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework"
import { deletePos } from "../../../../../../adapters/mercadopago/stores"
import {
  merchantCredentials,
  onboardingContext,
  sendOnboardingError,
} from "../../../onboarding-context"
import { assertPathId } from "../../../schemas"

/** DELETE /admin/pos-payments/stores/pos/:id — manutenção do vínculo (§10.1). */
export async function DELETE(
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) {
  try {
    const ctx = onboardingContext(req)
    const { token } = await merchantCredentials(req, ctx)
    const posId = assertPathId(req.params.id ?? "", "pos")
    await deletePos(ctx.http, token, posId)
    res.status(200).json({ deleted: true })
  } catch (error) {
    sendOnboardingError(res, error)
  }
}
