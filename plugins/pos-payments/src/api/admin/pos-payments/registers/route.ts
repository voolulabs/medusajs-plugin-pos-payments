import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework"
import { Modules } from "@medusajs/framework/utils"
import { z } from "@medusajs/framework/zod"
import { recordAudit } from "../../../../services/onboarding/audit"
import { OnboardingError } from "../../../../services/onboarding/errors"
import { onboardingContext, sendOnboardingError } from "../onboarding-context"

const registerSchema = z.object({
  registerId: z.string().uuid(),
  label: z.string().min(1).max(60).optional(),
})

/** Merge depth-1 do register no espelho (§5.4) — puro e testável. */
export function mergeRegister(
  metadata: unknown,
  input: { registerId: string; label?: string }
): Record<string, unknown> {
  const meta = { ...((metadata ?? {}) as Record<string, unknown>) }
  const pos = { ...((meta.pos ?? {}) as Record<string, unknown>) }
  const payments = { ...((pos.payments ?? {}) as Record<string, unknown>) }
  const registers = {
    ...((payments.registers ?? {}) as Record<string, unknown>),
  }
  const existing = (registers[input.registerId] ?? {}) as Record<
    string,
    unknown
  >
  registers[input.registerId] = {
    ...existing,
    ...(input.label ? { label: input.label } : {}),
  }
  payments.registers = registers
  pos.payments = payments
  return { ...meta, pos }
}

/** Lê o mapa de caixas espelhado (não-sensível) de metadata.pos.payments. */
export function registersOf(
  metadata: unknown
): Record<
  string,
  { label?: string; terminal?: { acquirer: string; id: string } }
> {
  const pos = ((metadata as Record<string, unknown>)?.pos ?? {}) as Record<
    string,
    unknown
  >
  const payments = (pos.payments ?? {}) as Record<string, unknown>
  return (payments.registers ?? {}) as never
}

/** GET/POST /admin/pos-payments/registers — caixas reportados pelo app
 * (idempotente; alimenta "Terminais por caixa" — onboarding.md §5.4). */
export async function GET(
  _req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) {
  try {
    const storeModule = _req.scope.resolve(Modules.STORE) as unknown as {
      listStores: (
        selectors?: unknown,
        config?: unknown
      ) => Promise<Array<{ metadata: unknown }>>
    }
    const [store] = await storeModule.listStores({}, { take: 1 })
    res.status(200).json({ registers: registersOf(store?.metadata) })
  } catch (error) {
    sendOnboardingError(res, error)
  }
}

export async function POST(
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) {
  try {
    const parsed = registerSchema.safeParse(req.body)
    if (!parsed.success) {
      throw new OnboardingError("invalid_credential", 400, "corpo inválido")
    }
    const { module, actorId } = onboardingContext(req)
    // Espelho de metadata (§5.4) — ver justificativa em terminals/[id]/select.
    const storeModule = req.scope.resolve(Modules.STORE) as unknown as {
      listStores: (
        selectors?: unknown,
        config?: unknown
      ) => Promise<Array<{ id: string; metadata: unknown }>>
      updateStores: (
        id: string,
        data: { metadata: Record<string, unknown> }
      ) => Promise<unknown>
    }
    const [store] = await storeModule.listStores({}, { take: 1 })
    if (!store) {
      throw new OnboardingError(
        "not_connected",
        409,
        "store do backend não encontrada"
      )
    }
    const metadata = mergeRegister(store.metadata, parsed.data as never)
    await storeModule.updateStores(store.id, { metadata })
    await recordAudit(module, {
      event: "registerBound",
      actorId,
      payload: { registerId: parsed.data.registerId },
    })
    res.status(200).json({ registers: registersOf(metadata) })
  } catch (error) {
    sendOnboardingError(res, error)
  }
}
