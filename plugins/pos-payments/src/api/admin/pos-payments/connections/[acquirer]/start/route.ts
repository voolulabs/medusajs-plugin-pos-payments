import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework"
import { authorizeUrl } from "../../../../../../adapters/mercadopago/onboarding"
import { issueState } from "../../../../../../services/onboarding/oauth-state"
import { recordAudit } from "../../../../../../services/onboarding/audit"
import { OnboardingError } from "../../../../../../services/onboarding/errors"
import {
  onboardingContext,
  resolveMpConfig,
  sendOnboardingError,
} from "../../../onboarding-context"

/** POST /admin/pos-payments/connections/:acquirer/start (§5.1/§7): emite o
 * `state` durável de uso único e devolve o authorize_url. O state NUNCA vai a
 * log; o navegador segue o authorize por full-page redirect (ADR 0004). */
export async function POST(
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) {
  try {
    if (req.params.acquirer !== "mercadopago") {
      sendOnboardingError(
        res,
        new OnboardingError("not_connected", 404, "adquirente não suportado")
      )
      return
    }
    const ctx = onboardingContext(req)
    const cfg = resolveMpConfig(req, ctx)
    const state = await issueState(ctx.module, "mercadopago", ctx.actorId)
    await recordAudit(ctx.module, {
      event: "started",
      acquirer: "mercadopago",
      actorId: ctx.actorId,
    })
    res.status(200).json({ authorize_url: authorizeUrl(cfg, state) })
  } catch (error) {
    sendOnboardingError(res, error)
  }
}
