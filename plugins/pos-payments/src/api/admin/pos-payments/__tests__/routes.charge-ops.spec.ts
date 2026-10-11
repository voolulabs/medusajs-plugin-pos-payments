import { describe, expect, it } from "vitest"
import { GET } from "../charges/[id]/route"
import { POST as CANCEL } from "../charges/[id]/cancel/route"
import { headerOf, makeReq, makeRes } from "./routes.helpers"

describe("GET /admin/pos-payments/charges/:id", () => {
  it("devolve o estado autoritativo da adquirente", async () => {
    const { req, calls } = makeReq({ params: { id: "ORD-9" } })
    const res = makeRes()
    await GET(req, res)
    expect(calls[0]!.url).toContain("/v1/orders/ORD-9")
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ chargeId: "ORD-9", rawStatus: "created" })
    )
  })

  it("sem bloco posTerminal (manual) → NOT_ALLOWED", async () => {
    const { req } = makeReq({ plugin: null, params: { id: "ORD-9" } })
    await expect(GET(req, makeRes())).rejects.toMatchObject({
      type: "not_allowed",
    })
  })
})

describe("POST /admin/pos-payments/charges/:id/cancel", () => {
  it("cancela com header incondicional e chave determinística", async () => {
    const { req, calls } = makeReq({
      params: { id: "ORD-1" },
      queue: [
        {
          status: 200,
          body: {
            id: "ORD-1",
            status: "canceled",
            type: "point",
            transactions: {
              payments: [
                { id: "PAY-1", amount: "19.99", status: "canceled_by_api" },
              ],
            },
          },
        },
      ],
    })
    const res = makeRes()
    await CANCEL(req, res)
    expect(calls[0]!.url).toContain("/v1/orders/ORD-1/cancel")
    expect(headerOf(calls[0]!.init, "x-allow-cancelable-status")).toBe(
      "at_terminal"
    )
    expect(headerOf(calls[0]!.init, "X-Idempotency-Key")).toBe(
      "058ef3c5-a31e-505b-8c3a-e1693db35cca"
    )
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ chargeId: "ORD-1", state: "canceled" })
    )
  })

  it("sem bloco posTerminal (manual) → NOT_ALLOWED", async () => {
    const { req } = makeReq({ plugin: null, params: { id: "ORD-1" } })
    await expect(CANCEL(req, makeRes())).rejects.toMatchObject({
      type: "not_allowed",
    })
  })
})
