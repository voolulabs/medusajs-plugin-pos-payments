/** Capture/cancel/refund do charge MP — confirmação local ou chamada idempotente. */
import { MedusaError } from "@medusajs/framework/utils"
import type { PosPaymentsAdapter } from "../../adapters/types"
import type { StructuredLogger } from "./mp-status"
import { applyTransition } from "./charge-state"

import { PROVIDER_LOG_ID } from "./service-mp"

/** Chave de idempotência: módulo puro próprio — service-mp (PROVIDER_LOG_ID)
 * e service-mp-ops se cruzam; um módulo único criaria ciclo de import. */
import { keyFor } from "./idempotency-key"
export { keyFor }

export function unexpected(what: string, detail: string): MedusaError {
  const msg = `mercadopago: ${what} (${detail})`
  return new MedusaError(MedusaError.Types.UNEXPECTED_STATE, msg)
}

/** Capture = confirmação LOCAL de que a MP credite (Point captura no processo). */
export async function mpCapture(
  adapter: PosPaymentsAdapter,
  data: Record<string, unknown>,
  logger: StructuredLogger
): Promise<{ data: Record<string, unknown> }> {
  if (data.captured_at) return { data }
  const chargeId = data.charge_id as string
  const view = await adapter.getCharge(chargeId)
  if (view.state !== "paid") {
    logger.warn("mercadopago: captura sem pagamento creditado", {
      provider_id: PROVIDER_LOG_ID,
      charge_id: chargeId,
      state: view.state,
    })
    throw unexpected("captura sem pagamento creditado", view.state)
  }
  logger.info("mercadopago: captura confirmada (local)", {
    provider_id: PROVIDER_LOG_ID,
    charge_id: chargeId,
    payment_id: view.paymentId,
  })
  return {
    data: applyTransition(
      { ...data, captured_at: new Date().toISOString() },
      "paid"
    ),
  }
}

export async function mpCancel(
  adapter: PosPaymentsAdapter,
  data: Record<string, unknown>,
  logger: StructuredLogger
): Promise<{ data: Record<string, unknown> }> {
  if (data.captured_at) {
    throw unexpected(
      "cancelamento de cobrança já capturada (usar refund)",
      "captured"
    )
  }
  let view
  try {
    const chargeId = data.charge_id as string
    // Header do contrato é decisão da camada MP (incondicional — errata
    // 2026-10-07); 202 assíncrono chega aqui como view awaiting_terminal +
    // cancelRequested (o desfecho confirma via poll/webhook).
    view = await adapter.cancelCharge(chargeId, keyFor(chargeId, "cancel"))
    logger.info("mercadopago: cancelamento aceito pela adquirente", {
      provider_id: PROVIDER_LOG_ID,
      charge_id: chargeId,
      to: view.state,
    })
  } catch (error) {
    logger.warn("mercadopago: 4xx/5xx no cancelamento", {
      provider_id: PROVIDER_LOG_ID,
      charge_id: data.charge_id,
      detail: String(error).slice(0, 120),
    })
    throw unexpected(
      "cancelamento recusado pela adquirente",
      "adquirente recusou"
    )
  }
  return { data: applyTransition({ ...data }, view.state) }
}
