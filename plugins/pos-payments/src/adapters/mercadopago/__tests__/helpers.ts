import { vi, type Mock } from "vitest"
import { MercadoPagoOrdersClient } from "../client"

/** Fixture de teste — NÃO é credencial: valor deliberadamente sem formato de token de adquirente. */
export const TEST_ACCESS_TOKEN = "test-token-fixture"

type FetchCall = { url: string; init: RequestInit }

/**
 * O mock grava toda chamada em `calls` e responde da `queue` em ordem;
 * esgotada a fila, cai na resposta-padrão de ordem (ORD-1/created).
 */
export function makeClient(queue: unknown[] = []): {
  client: MercadoPagoOrdersClient
  calls: FetchCall[]
  fetchImpl: Mock
  fixedKey: string
} {
  const calls: FetchCall[] = []
  const fixedKey = "idem-0001"
  const fetchImpl = vi.fn(async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} })
    const body =
      queue.length > 0
        ? queue.shift()
        : { id: "ORD-1", status: "created", type: "point" }
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })
  })
  const client = new MercadoPagoOrdersClient({
    accessToken: TEST_ACCESS_TOKEN,
    baseUrl: "https://api.test",
    fetchImpl: fetchImpl as unknown as typeof fetch,
  })
  return { client, calls, fetchImpl, fixedKey }
}

export function jsonResponse(
  body: unknown,
  status = 200,
  extraHeaders?: Record<string, string>
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...extraHeaders },
  })
}

export const TERMINALS_PAGE = {
  data: {
    terminals: [
      {
        id: "NEWLAND_N950__SBX0000001",
        pos_id: "47792476",
        store_id: "47792478",
        external_pos_id: "SUC0101POS",
        operating_mode: "PDV",
      },
    ],
  },
  paging: { total: 1, offset: 0, limit: 50 },
}

export const SETUP_RESPONSE = {
  terminals: [{ id: "NEWLAND_N950__SBX0000001", operating_mode: "PDV" }],
}
