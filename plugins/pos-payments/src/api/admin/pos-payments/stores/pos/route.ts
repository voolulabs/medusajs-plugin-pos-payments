import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework"
import { z } from "@medusajs/framework/zod"
import { createPos, listPos } from "../../../../../adapters/mercadopago/stores"
import { NAMESPACE_DNS, uuidV5 } from "../../../../../utils/uuid5"
import { OnboardingError } from "../../../../../services/onboarding/errors"
import {
  merchantCredentials,
  onboardingContext,
  sendOnboardingError,
} from "../../onboarding-context"

const createSchema = z.object({
  name: z.string().min(1).max(45).optional(),
  /** external_id = id do stock location no Medusa (≤40 alfanumérico, §10.1). */
  externalId: z.string().regex(/^[A-Za-z0-9_-]{1,40}$/),
  storeId: z
    .string()
    .regex(/^[0-9]{1,20}$/)
    .optional(),
  externalStoreId: z
    .string()
    .regex(/^[A-Za-z0-9_-]{1,60}$/)
    .optional(),
})

/** GET /admin/pos-payments/stores/pos?external_id=|store_id= (§10.1). */
export async function GET(
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) {
  try {
    const ctx = onboardingContext(req)
    const { token } = await merchantCredentials(req, ctx)
    const q = req.query as Record<string, string | undefined>
    const pos = await listPos(ctx.http, token, {
      ...(q.external_id ? { externalId: q.external_id } : {}),
      ...(q.store_id ? { storeId: q.store_id } : {}),
      ...(q.external_store_id ? { externalStoreId: q.external_store_id } : {}),
    })
    res.status(200).json({ pos })
  } catch (error) {
    sendOnboardingError(res, error)
  }
}

/** POST /admin/pos-payments/stores/pos — X-Idempotency-Key determinística
 * (uuidv5 de externalId+loja): retry devolve o MESMO POS (§10.1 exige header). */
export async function POST(
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) {
  try {
    const parsed = createSchema.safeParse(req.body)
    if (!parsed.success) {
      throw new OnboardingError("invalid_credential", 400, "corpo inválido")
    }
    if (!parsed.data.storeId && !parsed.data.externalStoreId) {
      throw new OnboardingError(
        "invalid_credential",
        400,
        "storeId ou externalStoreId obrigatório"
      )
    }
    const ctx = onboardingContext(req)
    const { token } = await merchantCredentials(req, ctx)
    const keySource = `${parsed.data.externalId}:${parsed.data.storeId ?? parsed.data.externalStoreId}`
    const pos = await createPos(
      ctx.http,
      token,
      {
        ...(parsed.data.name ? { name: parsed.data.name } : {}),
        externalId: parsed.data.externalId,
        ...(parsed.data.storeId ? { storeId: parsed.data.storeId } : {}),
        ...(parsed.data.externalStoreId
          ? { externalStoreId: parsed.data.externalStoreId }
          : {}),
      },
      uuidV5(keySource, NAMESPACE_DNS)
    )
    res.status(201).json({ pos })
  } catch (error) {
    sendOnboardingError(res, error)
  }
}
