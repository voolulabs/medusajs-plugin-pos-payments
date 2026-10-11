import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework"
import { Modules } from "@medusajs/framework/utils"
import { z } from "@medusajs/framework/zod"
import { recordAudit } from "../../../../../../services/onboarding/audit"
import { OnboardingError } from "../../../../../../services/onboarding/errors"
import {
  onboardingContext,
  sendOnboardingError,
} from "../../../onboarding-context"

const selectSchema = z.object({
  /** Sem registerId = default global (1 caixa, retrocompatível — §5.4). */
  registerId: z.string().uuid().optional(),
})

/** Merge depth-1 do terminal no espelho (§5.4) — puro e testável. */
export function mergeSelect(
  metadata: unknown,
  input: { acquirer: string; terminalId: string; registerId?: string }
): Record<string, unknown> {
  const meta = { ...((metadata ?? {}) as Record<string, unknown>) }
  const pos = { ...((meta.pos ?? {}) as Record<string, unknown>) }
  const payments = { ...((pos.payments ?? {}) as Record<string, unknown>) }
  if (input.registerId) {
    const registers = {
      ...((payments.registers ?? {}) as Record<string, unknown>),
    }
    const current = (registers[input.registerId] ?? {}) as Record<
      string,
      unknown
    >
    registers[input.registerId] = {
      ...current,
      terminal: { acquirer: input.acquirer, id: input.terminalId },
    }
    payments.registers = registers
  } else {
    payments.terminal = { acquirer: input.acquirer, id: input.terminalId }
  }
  pos.payments = payments
  return { ...meta, pos }
}

/** POST /admin/pos-payments/terminals/:id/select — grava o terminal
 * selecionado; com registerId = binding por caixa em
 * `metadata.pos.payments.registers` (merge depth-1 — o app de caixa sobrescreve
 * metadata.pos inteiro ao salvar Settings, o plugin JAMAIS o substitui: §5.4/§7.1). */
export async function POST(
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) {
  try {
    const parsed = selectSchema.safeParse(req.body)
    if (!parsed.success) {
      throw new OnboardingError("invalid_credential", 400, "corpo inválido")
    }
    const terminalId = req.params.id
    const acquirer = "mercadopago"
    const { module, actorId } = onboardingContext(req)
    // Espelho de metadata (onboarding.md §5.4) — escrita direta aceita no
    // contrato: merge depth-1 e o audit fica na tabela do plugin (§8), não no
    // core store. Mutações das TABELAS do plugin passam por serviços/workflows.
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
    const metadata = mergeSelect(store.metadata, {
      acquirer,
      terminalId,
      registerId: parsed.data.registerId,
    } as never)
    await storeModule.updateStores(store.id, { metadata })
    await recordAudit(module, {
      event: "terminalSelected",
      acquirer,
      actorId,
      payload: { terminalId, registerId: parsed.data.registerId ?? null },
    })
    res.status(200).json({ selected: terminalId })
  } catch (error) {
    sendOnboardingError(res, error)
  }
}
