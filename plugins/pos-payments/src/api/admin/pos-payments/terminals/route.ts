import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework"
import { adapterForRequest } from "../adapter-scope"
import { assertPathId, parseOrThrow, terminalsQuerySchema } from "../schemas"
import { toMedusaError } from "../errors"

/**
 * GET /admin/pos-payments/terminals (§6.3): terminais ativos na conta, com
 * resposta AGNÓSTICA de adquirente ({terminals, paging}) — o mapeamento
 * snake_case→domínio acontece no adapter.
 */
export async function GET(
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) {
  const query = parseOrThrow(terminalsQuerySchema, req.query)
  // Guard SSRF em segunda camada (o zod já restringe; o assert explicita o
  // ponto de sanitização antes do fetch da adquirente).
  if (query.storeId !== undefined) assertPathId(query.storeId, "store_id")
  if (query.posId !== undefined) assertPathId(query.posId, "pos_id")
  const adapter = adapterForRequest(req)
  try {
    const page = await adapter.listTerminals({
      ...(query.limit !== undefined ? { limit: query.limit } : {}),
      ...(query.offset !== undefined ? { offset: query.offset } : {}),
      ...(query.storeId !== undefined ? { storeId: query.storeId } : {}),
      ...(query.posId !== undefined ? { posId: query.posId } : {}),
    })
    res.json(page)
  } catch (error) {
    throw toMedusaError(error)
  }
}
