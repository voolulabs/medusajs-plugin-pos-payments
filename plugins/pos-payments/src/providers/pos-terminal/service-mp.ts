/** Operações de ciclo de vida do charge por adapter (usadas pelo service). */
import { MedusaError } from "@medusajs/framework/utils"
import type {
  CreateChargeInput,
  PosPaymentsAdapter,
} from "../../adapters/types"
import { applyTransition } from "./charge-state"
import { assertTerminalId, assertMinorAmount } from "./charge-input"
import { keyFor } from "./idempotency-key"
import type { StructuredLogger } from "./mp-status"

export const PROVIDER_LOG_ID = "pp_pos-terminal_mercadopago"

/** Chaves que SÓ o provider grava — replay do cliente não as forja. */
const RESERVADAS = new Set([
  "charge_id",
  "acquirer",
  "idempotency_key",
  "amount_minor",
  "state",
  "data_version",
])

/**
 * Semente determinística de idempotência — sem id, falha alta (nunca aleatória).
 * Contrato do core, idêntico em 2.19 dist e 2.21.1 fonte (L3 2026-10-05):
 * `data: { ...input.data, session_id }` + `context: { idempotency_key: session.id }`.
 * A leitura original por `context.session_id` nunca existiu no contrato; a união
 * abaixo é defesa em profundidade (primeira string presente vence), não
 * divergência de versão.
 */
function sessionSeed(input: {
  id?: string
  data?: Record<string, unknown>
  context?: { session_id?: string; idempotency_key?: unknown }
}): string {
  const dataSeed = input.data?.session_id
  const ctxKey = input.context?.idempotency_key
  const seed =
    input.context?.session_id ??
    (typeof dataSeed === "string" ? dataSeed : undefined) ??
    (typeof ctxKey === "string" ? ctxKey : undefined) ??
    input.id
  if (!seed) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "mercadopago: sem id de sessão não há idempotência determinística"
    )
  }
  return seed
}

/** External reference: <=64 chars [A-Za-z0-9-_], sem PII — fail-closed. */
function assertExternalReference(seed: string): string {
  if (!/^[A-Za-z0-9-_]{1,64}$/.test(seed)) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "mercadopago: id de sessão fora do alfabeto da external_reference"
    )
  }
  return seed
}

export async function mpInitiate(
  adapter: PosPaymentsAdapter,
  input: {
    amount: unknown
    id?: string
    data?: Record<string, unknown>
    context?: Record<string, unknown>
  },
  logger: StructuredLogger
): Promise<{ id: string; data: Record<string, unknown> }> {
  const seed = sessionSeed(input)
  const key = keyFor(seed, "charge")
  const createInput: CreateChargeInput = {
    amountMinor: assertMinorAmount(input.amount),
    externalReference: assertExternalReference(seed),
    terminalId: assertTerminalId(input),
  }
  const { chargeId, view } = await adapter.createCharge(createInput, key)
  // Blob COMPLETO: preserva o data da sessão, exceto as chaves reservadas do
  // charge — state/data_version nunca são forjados pelo replay do cliente.
  const data = applyTransition(
    {
      ...Object.fromEntries(
        Object.entries(input.data ?? {}).filter(([k]) => !RESERVADAS.has(k))
      ),
      charge_id: chargeId,
      acquirer: adapter.acquirer,
      idempotency_key: key,
      amount_minor: createInput.amountMinor,
    },
    view.state
  )
  logger.info("mercadopago: charge criado na adquirente", {
    provider_id: PROVIDER_LOG_ID,
    charge_id: chargeId,
    external_reference: createInput.externalReference,
    state: view.state,
  })
  return { id: chargeId, data }
}
