import { describe, expect, it, vi } from "vitest"
import { MercadoPagoOrdersClient } from "../client"
import { MpApiError } from "../types"
import { jsonResponse, TEST_ACCESS_TOKEN } from "./helpers"

type FetchCall = { url: string; init: RequestInit }

function clientWith(
  opts: {
    timeoutMs?: number
    respond?: (init: RequestInit) => Response
  } = {}
): { client: MercadoPagoOrdersClient; calls: FetchCall[] } {
  const calls: FetchCall[] = []
  const fetchImpl = vi.fn(async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} })
    return opts.respond
      ? opts.respond(init ?? {})
      : jsonResponse({ error: "rate_limited" }, 429, { "Retry-After": "20" })
  })
  const client = new MercadoPagoOrdersClient({
    accessToken: TEST_ACCESS_TOKEN,
    baseUrl: "https://api.test",
    fetchImpl: fetchImpl as unknown as typeof fetch,
    ...(opts.timeoutMs === undefined ? {} : { timeoutMs: opts.timeoutMs }),
  })
  return { client, calls }
}

async function getError(promise: Promise<unknown>): Promise<MpApiError> {
  return (await promise.catch((e: unknown) => e)) as MpApiError
}

function expectCommonHeaders(init: RequestInit): void {
  const headers = init.headers as Record<string, string>
  expect(headers.Authorization).toBe(`Bearer ${TEST_ACCESS_TOKEN}`)
  expect(headers["Content-Type"]).toBe("application/json")
}

describe("429 rate limit — helper respeita Retry-After (ADR 0001)", () => {
  it("429 com Retry-After expõe o header no MpApiError", async () => {
    const { client, calls } = clientWith()
    const error = await getError(client.getOrder("ORD-1"))
    expect(error).toBeInstanceOf(MpApiError)
    expect(error.status).toBe(429)
    expect(error.retryAfter).toBe("20")
    expect(calls[0]!.url).toBe("https://api.test/v1/orders/ORD-1")
    expect(calls[0]!.init.method).toBe("GET")
    expectCommonHeaders(calls[0]!.init)
  })

  it("429 sem Retry-After deixa retryAfter undefined", async () => {
    const { client } = clientWith({ respond: () => jsonResponse({}, 429) })
    const error = await getError(client.getOrder("ORD-1"))
    expect(error.status).toBe(429)
    expect(error.retryAfter).toBeUndefined()
  })

  it("não-429 não expõe retryAfter mesmo com header presente", async () => {
    const { client } = clientWith({
      respond: () =>
        jsonResponse({ message: "boom" }, 500, { "Retry-After": "20" }),
    })
    const error = await getError(client.getOrder("ORD-1"))
    expect(error.status).toBe(500)
    expect(error.retryAfter).toBeUndefined()
  })
})

describe("timeout duro rejeita a promise", () => {
  it("abort do AbortSignal rejeita (não pendura a chamada)", async () => {
    const calls: FetchCall[] = []
    const fetchImpl = ((_url: string | URL, init?: RequestInit) => {
      calls.push({ url: String(_url), init: init ?? {} })
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(new Error("aborted pelo timeout"))
        )
      })
    }) as typeof fetch
    const client = new MercadoPagoOrdersClient({
      accessToken: TEST_ACCESS_TOKEN,
      baseUrl: "https://api.test",
      fetchImpl,
      timeoutMs: 20,
    })
    await expect(client.getOrder("ORD-1")).rejects.toThrow("aborted")
    expectCommonHeaders(calls[0]!.init)
  })
})
