/** getWebhookActionAndData (T5): valida HMAC, re-fetcha e mapeia — nunca lança. */
import type { WebhookActionResult } from "@medusajs/framework/types"
import type { ChargeStatusView, PosPaymentsAdapter } from "../../adapters/types"
import { PROVIDER_LOG_ID } from "./service-mp"
import type { StructuredLogger } from "./mp-status"
import { validateWebhookSignature } from "./webhook-signature"

/** Payload que o subscriber do core entrega (event-bus.md §2, verificado). */
export type WebhookPayload = {
  data: Record<string, unknown>
  rawData: Buffer
  headers: Record<string, string>
}

// O retorno é o WebhookActionResult do core (session_id + amount quando há ação).

/** Pura: extrai o id do envelope cru (parse único — o canonical usa ESTE id). */
export function parseEnvelope(rawData: Buffer): { id?: string } {
  try {
    const parsed = JSON.parse(rawData.toString("utf8")) as {
      data?: { id?: unknown }
    }
    const id = parsed.data?.id
    return { ...(id !== undefined ? { id: String(id) } : {}) }
  } catch {
    return {}
  }
}

/** Mapa estado → action do core (spec T5 §4). Sem session_id confiável = descarte. */
function acaoPorEstado(view: ChargeStatusView): WebhookActionResult {
  // captured é a única ação que o core processa; exige session_id + amount.
  if (view.state === "paid") {
    return view.externalReference !== undefined &&
      view.amountMinor !== undefined
      ? {
          action: "captured",
          data: {
            session_id: view.externalReference,
            amount: view.amountMinor,
          },
        }
      : { action: "failed" }
  }
  // refunded/canceled de terminal: o core não processa — o subscriber do
  // plugin re-fetcha por conta própria (ADR 0007).
  if (view.state === "refunded" || view.state === "canceled") {
    return { action: "not_supported" }
  }
  return { action: "pending" }
}

export async function mpWebhookAction(
  adapter: PosPaymentsAdapter,
  payload: WebhookPayload,
  secret: string,
  logger: StructuredLogger
): Promise<WebhookActionResult> {
  const { id } = parseEnvelope(payload.rawData)
  const assinado =
    id !== undefined &&
    validateWebhookSignature(payload.headers, { data: { id } }, secret)
  if (!assinado) {
    logger.warn("mercadopago: webhook descartado (assinatura)", {
      provider_id: PROVIDER_LOG_ID,
      charge_id: id ?? "ausente",
    })
    return { action: "failed" }
  }
  try {
    // ADR 0001: o estado vem do RE-FETCH, nunca do payload.
    return acaoPorEstado(await adapter.getCharge(id!))
  } catch (error) {
    logger.warn("mercadopago: webhook falhou no re-fetch", {
      provider_id: PROVIDER_LOG_ID,
      // id é definido aqui por construção (a assinatura exige data.id).
      charge_id: id!,
      detail: String(error).slice(0, 160),
    })
    return { action: "failed" }
  }
}
