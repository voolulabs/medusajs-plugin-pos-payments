import { describe, expect, it, vi } from "vitest"
import { TERMINALS_PAGE } from "./helpers"
import { MercadoPagoAdapter } from "../adapter"

describe("MpAdapter.listTerminals", () => {
  it("mapeia a página snake_case para o domínio agnóstico", async () => {
    const fetchImpl = vi.fn(
      async (_url: string | URL, _init?: RequestInit) =>
        new Response(JSON.stringify(TERMINALS_PAGE), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
    )
    const adapter = new MercadoPagoAdapter({
      accessToken: "test-token-fixture",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    const page = await adapter.listTerminals({ limit: 2, storeId: "123" })
    expect(page.terminals).toEqual([
      {
        id: "NEWLAND_N950__SBX0000001",
        storeId: "47792478",
        posId: "47792476",
        externalPosId: "SUC0101POS",
        operatingMode: "PDV",
      },
    ])
    expect(page.paging).toEqual({ total: 1, offset: 0, limit: 50 })
    expect(String(fetchImpl.mock.calls[0]![0])).toContain(
      "/terminals/v1/list?limit=2&store_id=123"
    )
  })

  it("sem query usa o default do server (URL sem QS)", async () => {
    const fetchImpl = vi.fn(
      async (_url: string | URL, _init?: RequestInit) =>
        new Response(JSON.stringify(TERMINALS_PAGE), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
    )
    const adapter = new MercadoPagoAdapter({
      accessToken: "test-token-fixture",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    const page = await adapter.listTerminals()
    expect(page.terminals).toHaveLength(1)
    expect(
      String(fetchImpl.mock.calls[0]![0]).endsWith("/terminals/v1/list")
    ).toBe(true)
  })
})
