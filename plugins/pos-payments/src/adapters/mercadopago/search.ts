/** GET /v1/orders — busca por external_reference (reconsulta de colisão 409). */
import type { MercadoPagoOrdersClient } from "./client"
import { parseOrder } from "./schema"
import {
  MpContractError,
  MpIdempotencyConflictError,
  type MpOrder,
} from "./types"

/** Janela padrão: ordem criada nas últimas 24h (expiration máxima é 3h). */
function janelaPadrao(): { begin_date: string; end_date: string } {
  const agora = Date.now()
  return {
    begin_date: new Date(agora - 24 * 60 * 60 * 1000).toISOString(),
    end_date: new Date(agora + 60 * 60 * 1000).toISOString(),
  }
}

/** Nunca recria: a colisão de idempotência reconsulta por referência. */
async function searchOrdersByExternalReference(
  client: MercadoPagoOrdersClient,
  externalReference: string
): Promise<MpOrder[]> {
  const params = new URLSearchParams({
    external_reference: externalReference,
    ...janelaPadrao(),
  })
  const response = await client.request(
    "GET",
    `/v1/orders?${params.toString()}`
  )
  const data = (response as { data?: unknown })?.data
  // Formato fora do contrato lança MpContractError — silenciar lista vazia
  // esconderia a causa real atrás do 409 relançado pelo adapter.
  if (!Array.isArray(data)) {
    throw new MpContractError(
      "resposta da busca fora do contrato: data ausente ou não é lista"
    )
  }
  return (data as unknown[]).map((item) => parseOrder(item))
}

/**
 * Recuperação da colisão de idempotência: 409 reconsulta por referência e
 * devolve a ordem existente; sem colisão ou sem ordem achada, relança o
 * original (nunca recria — ADR 0001 §6).
 */
export async function recoverByIdempotencyConflict(
  client: MercadoPagoOrdersClient,
  externalReference: string,
  original: unknown
): Promise<MpOrder> {
  if (!(original instanceof MpIdempotencyConflictError)) throw original
  const orders = await searchOrdersByExternalReference(
    client,
    externalReference
  )
  const found = orders.find(
    (candidate) => candidate.external_reference === externalReference
  )
  if (!found) throw original
  // A busca pode vir parcial (sem config/terminal): a cobrança é confirmada
  // na ordem completa antes do reuse-guard.
  return client.getOrder(found.id)
}
