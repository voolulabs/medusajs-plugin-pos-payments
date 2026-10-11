import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework"
import {
  refreshOnboardingToken,
  validateOnboardingConnection,
} from "../../../../../../adapters/mercadopago/onboarding"
import {
  findConnection,
  setStatus,
  type ConnectionRow,
} from "../../../../../../services/onboarding/connections"
import { recordAudit } from "../../../../../../services/onboarding/audit"
import { getValidAccessToken } from "../../../../../../services/onboarding/refresh"
import { OnboardingError } from "../../../../../../services/onboarding/errors"
import {
  onboardingContext,
  resolveMpConfig,
  sendOnboardingError,
} from "../../../onboarding-context"

/** Falha do /test: credencial recusada = reconexão (runbook §2 — e de
 * action_required, degraded nem é transição legal, §4); 5xx/rede degrada só
 * a partir de connected; demais estados seguem como estão. */
async function tratarFalhaDeTeste(
  ctx: ReturnType<typeof onboardingContext>,
  conn: ConnectionRow,
  acquirer: string,
  error: unknown,
  res: MedusaResponse
): Promise<void> {
  if (error instanceof OnboardingError && error.code === "invalid_credential") {
    await setStatus(ctx.module, conn, "action_required", {
      reason: "reauthorize",
    })
    res.status(200).json({ status: "action_required" })
    return
  }
  if (conn.status === "connected") {
    await setStatus(ctx.module, conn, "degraded")
    await recordAudit(ctx.module, {
      event: "degraded",
      acquirer,
      actorId: ctx.actorId,
    })
    res.status(200).json({ status: "degraded" })
    return
  }
  res.status(200).json({ status: conn.status })
}

/** §4: estados de onde o /test pode pousar em connected. */
export function podePromover(
  status: string,
  actionReason: string | null
): boolean {
  return (
    status === "connected" ||
    status === "degraded" ||
    (status === "action_required" && actionReason === "reauthorize")
  )
}

/** POST /admin/pos-payments/connections/:acquirer/test (§5.1): revalida AGORA
 * com chamada barata → connected (lastValidatedAt) ou degraded/action_required.
 * Renovação lazy acontece aqui se o access token estiver perto do expiry. */
export async function POST(
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) {
  try {
    const acquirer = req.params.acquirer
    if (acquirer !== "mercadopago") {
      throw new OnboardingError(
        "not_connected",
        404,
        "adquirente não suportado"
      )
    }
    const ctx = onboardingContext(req)
    const cfg = resolveMpConfig(req, ctx)
    const conn = await findConnection(ctx.module, acquirer)
    if (!conn)
      throw new OnboardingError("not_connected", 404, "conexão inexistente")
    try {
      const token = await getValidAccessToken({
        module: ctx.module,
        acquirer,
        refresh: (rt) => refreshOnboardingToken(ctx.http, cfg, rt),
      })
      await validateOnboardingConnection(ctx.http, token)
      // Só promove a connected a partir de connected/degraded — outros estados
      // (action_required com motivo não-reauthorize) não se resolvem aqui (§4).
      const promovivel = podePromover(conn.status, conn.actionReason)
      await ctx.module.updatePosPaymentsConnections([
        {
          id: conn.id,
          ...(promovivel ? { status: "connected", actionReason: null } : {}),
          lastValidatedAt: new Date(),
          updatedBy: ctx.actorId,
        } as never,
      ])
      res.status(200).json({ status: promovivel ? "connected" : conn.status })
    } catch (error) {
      if (error instanceof OnboardingError && error.code === "reauthorize") {
        throw error // refresh já marcou action_required:reauthorize + audit
      }
      await tratarFalhaDeTeste(ctx, conn, acquirer, error, res)
      return
    }
  } catch (error) {
    sendOnboardingError(res, error)
  }
}
