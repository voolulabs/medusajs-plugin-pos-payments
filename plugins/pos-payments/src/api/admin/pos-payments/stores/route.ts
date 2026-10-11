import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework"
import { z } from "@medusajs/framework/zod"
import {
  createStore,
  searchStores,
} from "../../../../adapters/mercadopago/stores"
import { findConnection } from "../../../../services/onboarding/connections"
import { getValidAccessToken } from "../../../../services/onboarding/refresh"
import { OnboardingError } from "../../../../services/onboarding/errors"
import {
  merchantCredentials,
  onboardingContext,
  sendOnboardingError,
} from "../onboarding-context"

const createSchema = z.object({
  name: z.string().min(1).max(60),
  /** external_id = id da unidade no Medusa (≤60 alfanumérico, §10.1). */
  externalId: z.string().regex(/^[A-Za-z0-9_-]{1,60}$/),
  location: z.record(z.string(), z.unknown()).optional(),
  businessHours: z.record(z.string(), z.unknown()).optional(),
})

/** GET /admin/pos-payments/stores?external_id= — busca de lojas (§10.1). */
export async function GET(
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) {
  try {
    const ctx = onboardingContext(req)
    const { token, userId } = await merchantCredentials(req, ctx)
    const externalId =
      typeof req.query.external_id === "string"
        ? req.query.external_id
        : undefined
    const stores = await searchStores(
      ctx.http,
      token,
      userId,
      externalId ? { externalId } : {}
    )
    res.status(200).json({ stores })
  } catch (error) {
    sendOnboardingError(res, error)
  }
}

/** POST /admin/pos-payments/stores — cadastra a loja física (§10.1). */
export async function POST(
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) {
  try {
    const parsed = createSchema.safeParse(req.body)
    if (!parsed.success) {
      throw new OnboardingError("invalid_credential", 400, "corpo inválido")
    }
    const ctx = onboardingContext(req)
    const { token, userId } = await merchantCredentials(req, ctx)
    const store = await createStore(ctx.http, token, userId, {
      name: parsed.data.name,
      externalId: parsed.data.externalId,
      ...(parsed.data.location ? { location: parsed.data.location } : {}),
      ...(parsed.data.businessHours
        ? { businessHours: parsed.data.businessHours }
        : {}),
    })
    res.status(201).json({ store })
  } catch (error) {
    sendOnboardingError(res, error)
  }
}
