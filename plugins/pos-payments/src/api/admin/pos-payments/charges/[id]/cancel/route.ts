import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework"
import type { ChargeStatusView } from "../../../../../../adapters/types"
import { MpApiError } from "../../../../../../adapters/mercadopago/types"
import { keyFor } from "../../../../../../providers/pos-terminal/service-mp-ops"
import { adapterForRequest } from "../../../adapter-scope"
import { assertChargeId } from "../../../schemas"
import { toMedusaError } from "../../../errors"

/**
 * POST /admin/pos-payments/charges/:id/cancel — contrato POR ESTADO (E1–E8,
 * docs .mx 2026-10-07): `created` cancela 200 síncrono; `at_terminal` devolve
 * 202 ASSÍNCRONO (a ordem segue at_terminal com cancellation_requested — o
 * terminal pode priorizar a cobrança e capturar); estados não canceláveis →
 * 409 cannot_cancel_order; order_already_canceled → re-fetch: canceled →
 * 200 idempotente, estado divergente → 409 com o estado real.
 * Os 409 respondem DIRETO em res: o error-handler do core SOBRESCREVE a
 * mensagem de MedusaError CONFLICT (MC4 — dist 2.19 framework/http).
 */

/** 200 p/ canceled; 202 p/ TODO outro estado de um cancel 2xx — cancel bem
 * sucedido sobre at_terminal é SEMPRE assíncrono (E1/E3), com ou sem o eco de
 * cancellation_requested no corpo (a docs da MP diverge por região/idioma, E9). */
function respondCancel(
  res: MedusaResponse,
  chargeId: string,
  view: ChargeStatusView
): void {
  if (view.state === "canceled") {
    res.status(200).json({ chargeId, ...view })
    return
  }
  res.status(202).json({ chargeId, ...view })
}

/** 409 semântico direto em res (MC4). Devolve true quando o erro é do
 * contrato de cancelamento e a resposta já foi dada. */
async function respondRefusal(
  res: MedusaResponse,
  adapter: { getCharge(id: string): Promise<ChargeStatusView> },
  chargeId: string,
  error: unknown
): Promise<boolean> {
  if (!(error instanceof MpApiError) || error.status !== 409) return false
  const code = error.code
  if (code !== "cannot_cancel_order" && code !== "order_already_canceled") {
    return false
  }
  // Estado real no corpo: o caixa mostra o porquê (action_required,
  // expired…). Falha no re-fetch NÃO bloqueia o 409.
  const current = await adapter.getCharge(chargeId).catch(() => undefined)
  if (code === "order_already_canceled" && current?.state === "canceled") {
    res.status(200).json({ chargeId, ...current })
    return true
  }
  res.status(409).json({
    code,
    message:
      code === "cannot_cancel_order"
        ? "A cobrança não pode mais ser cancelada na adquirente."
        : "A cobrança já estava cancelada na adquirente.",
    state: current?.state ?? "desconhecido",
  })
  return true
}

export async function POST(
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) {
  const chargeId = assertChargeId(req.params.id)
  const adapter = adapterForRequest(req)
  try {
    const view = await adapter.cancelCharge(
      chargeId,
      keyFor(chargeId, "cancel")
    )
    respondCancel(res, chargeId, view)
  } catch (error) {
    if (await respondRefusal(res, adapter, chargeId, error)) return
    throw toMedusaError(error)
  }
}
