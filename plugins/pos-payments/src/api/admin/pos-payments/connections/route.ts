import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework"
import { findConnection } from "../../../../services/onboarding/connections"
import { sendOnboardingError, onboardingContext } from "../onboarding-context"

/** GET /admin/pos-payments/connections — resumo por adquirente (§5.1): estado
 * NÃO-sensível que alimenta a página do Admin, o widget e o health do POS. */
export async function GET(
  _req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) {
  try {
    const { module } = onboardingContext(_req)
    const rows = (await module.listPosPaymentsConnections(
      {}
    )) as unknown as Array<Record<string, unknown>>
    res.status(200).json({
      connections: rows.map((row) => ({
        acquirer: row.acquirer,
        status: row.status,
        actionReason: row.actionReason ?? null,
        externalRefs: row.externalRefs ?? null,
        expiresAt: row.expiresAt ?? null,
        lastValidatedAt: row.lastValidatedAt ?? null,
      })),
    })
  } catch (error) {
    sendOnboardingError(res, error)
  }
}
