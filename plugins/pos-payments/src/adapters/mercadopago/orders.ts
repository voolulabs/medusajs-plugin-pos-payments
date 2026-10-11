import type { MercadoPagoOrdersClient } from "./client"
import { parseOrder } from "./schema"
import type { MpOrder } from "./types"

/** POST /v1/orders/{id}/cancel — idempotency key obrigatória. */
export async function cancelOrder(
  client: MercadoPagoOrdersClient,
  orderId: string,
  idempotencyKey: string
): Promise<MpOrder> {
  // Header INCONDICIONAL (errata 2026-10-07, docs .mx): exigido em
  // `at_terminal` (202 assíncrono) e IGNORADO em `created` — a MP carrega a
  // ordem no terminal em segundos e o blob local chega atrasado. A decisão
  // é da camada MP; o chamador não opina.
  return parseOrder(
    await client.request(
      "POST",
      `/v1/orders/${encodeURIComponent(orderId)}/cancel`,
      {
        idempotencyKey,
        extraHeaders: { "x-allow-cancelable-status": "at_terminal" },
      }
    )
  )
}

/** POST /v1/orders/{id}/refund — Point só suporta estorno total (body vazio, 201). */
export async function refundOrder(
  client: MercadoPagoOrdersClient,
  orderId: string,
  idempotencyKey: string
): Promise<MpOrder> {
  return parseOrder(
    await client.request(
      "POST",
      `/v1/orders/${encodeURIComponent(orderId)}/refund`,
      { idempotencyKey }
    )
  )
}

/**
 * Refund resiliente por ESTADO (ADR 0001): o POST pode falhar porque a ordem
 * já foi reembolsada (origem terminal — reconciliação do T5) ou com o refund
 * criado em trânsito. O veredito vem do re-fetch da ordem, nunca do corpo do
 * erro: `refunded` volta como sucesso; qualquer outro estado relança o erro
 * original (falha de permissão não vira falso sucesso).
 */
export async function refundOrderResilient(
  client: MercadoPagoOrdersClient,
  orderId: string,
  idempotencyKey: string
): Promise<MpOrder> {
  try {
    return await refundOrder(client, orderId, idempotencyKey)
  } catch (error) {
    try {
      const order = await client.getOrder(orderId)
      if (order.status === "refunded") return order
    } catch {
      // Sem visibilidade do estado real: relança o erro original.
    }
    throw error
  }
}
