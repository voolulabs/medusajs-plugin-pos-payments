import { describe, expect, it } from "vitest"
import { GET } from "../terminals/route"
import { TERMINALS_PAGE } from "../../../../adapters/mercadopago/__tests__/helpers"
import { makeReq, makeRes } from "./routes.helpers"

describe("GET /admin/pos-payments/terminals", () => {
  it("devolve a página agnóstica mapeada para o domínio", async () => {
    const { req, calls } = makeReq({
      query: { limit: "2", storeId: "47792478", offset: "4" },
      queue: [{ status: 200, body: TERMINALS_PAGE }],
    })
    const res = makeRes()
    await GET(req, res)
    expect(calls[0]!.url).toContain("/terminals/v1/list?")
    expect(calls[0]!.url).toContain("limit=2")
    expect(calls[0]!.url).toContain("store_id=47792478")
    expect(res.json).toHaveBeenCalledWith({
      terminals: [
        {
          id: "NEWLAND_N950__SBX0000001",
          storeId: "47792478",
          posId: "47792476",
          externalPosId: "SUC0101POS",
          operatingMode: "PDV",
        },
      ],
      paging: { total: 1, offset: 0, limit: 50 },
    })
  })

  it("sem query lista com o default do server (URL sem QS)", async () => {
    const { req, calls } = makeReq({
      queue: [{ status: 200, body: TERMINALS_PAGE }],
    })
    await GET(req, makeRes())
    expect(calls[0]!.url.endsWith("/terminals/v1/list")).toBe(true)
  })

  it("400 para limit acima do teto e para store_id não numérico", async () => {
    for (const query of [
      { limit: "60" },
      { storeId: "loja-a" },
      { offset: "-1" },
    ]) {
      const { req } = makeReq({ query })
      await expect(GET(req, makeRes())).rejects.toMatchObject({
        type: "invalid_data",
      })
    }
  })

  it("sem bloco posTerminal (manual) → NOT_ALLOWED", async () => {
    const { req } = makeReq({ plugin: null })
    await expect(GET(req, makeRes())).rejects.toMatchObject({
      type: "not_allowed",
    })
  })
})
