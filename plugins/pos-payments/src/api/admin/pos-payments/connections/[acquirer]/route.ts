import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework"
import { z } from "@medusajs/framework/zod"
import { validateOnboardingConnection } from "../../../../../adapters/mercadopago/onboarding"
import {
  connectValidated,
  disconnectConnection,
  findConnection,
} from "../../../../../services/onboarding/connections"
import { recordAudit } from "../../../../../services/onboarding/audit"
import { OnboardingError } from "../../../../../services/onboarding/errors"
import {
  onboardingContext,
  sendOnboardingError,
} from "../../onboarding-context"

const ACQUIRERS = new Set(["mercadopago"])

const pastedSchema = z.object({
  /** Credencial colada (validate-then-activate — §1.1/§5.1). */
  accessToken: z.string().min(20),
})

function acquirerOf(req: {
  params: Record<string, string | undefined>
}): string {
  const acquirer = req.params.acquirer ?? ""
  if (!ACQUIRERS.has(acquirer)) {
    throw new OnboardingError("not_connected", 404, "adquirente não suportado")
  }
  return acquirer
}

/** GET — detalhe não-sensível da conexão (§5.1). */
export async function GET(
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) {
  try {
    const { module } = onboardingContext(req)
    const conn = await findConnection(module, acquirerOf(req))
    if (!conn)
      throw new OnboardingError("not_connected", 404, "conexão inexistente")
    res.status(200).json({
      connection: {
        acquirer: conn.acquirer,
        status: conn.status,
        actionReason: conn.actionReason,
        externalRefs: conn.externalRefs,
        expiresAt: conn.expiresAt,
        lastValidatedAt: conn.lastValidatedAt,
      },
    })
  } catch (error) {
    sendOnboardingError(res, error)
  }
}

/** POST — credencial colada: valida com chamada real ANTES de ativar (§5.1). */
export async function POST(
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) {
  let acquirer: string
  try {
    acquirer = acquirerOf(req)
  } catch (error) {
    sendOnboardingError(res, error)
    return
  }
  const parsed = pastedSchema.safeParse(req.body)
  if (!parsed.success) {
    sendOnboardingError(
      res,
      new OnboardingError("invalid_credential", 400, "corpo inválido")
    )
    return
  }
  try {
    const { module, http, actorId } = onboardingContext(req)
    const conn = await connectValidated(module, {
      acquirer,
      secret: { access_token: parsed.data.accessToken },
      actorId,
      from: "unconfigured",
      validate: () =>
        validateOnboardingConnection(http, parsed.data.accessToken),
    })
    res.status(200).json({ status: conn.status })
  } catch (error) {
    const { module, actorId } = onboardingContext(req)
    await recordAudit(module, {
      event: "validationFailed",
      acquirer,
      actorId,
    }).catch(() => undefined)
    sendOnboardingError(res, error)
  }
}

/** DELETE — desconecta: purga segredos, mantém audit (§5.1/§8). */
export async function DELETE(
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) {
  try {
    const acquirer = acquirerOf(req)
    const { module, actorId } = onboardingContext(req)
    await disconnectConnection(module, acquirer, actorId)
    res.status(200).json({ status: "disconnected" })
  } catch (error) {
    sendOnboardingError(res, error)
  }
}
