import { beforeEach, describe, expect, it } from "vitest"
import { makeClient, TEST_ACCESS_TOKEN } from "./helpers"

describe("MercadoPagoOrdersClient — createPointOrder (contrato)", () => {
  let ctx: ReturnType<typeof makeClient>
  beforeEach(() => {
    ctx = makeClient()
  })

  it("POST /v1/orders com payload mínimo, headers de auth e idempotency", async () => {
    await ctx.client.createPointOrder(
      {
        amount: "10.00",
        externalReference: "pos-charge-1",
        terminalId: "NEWLAND_N950__SBX0000001",
      },
      ctx.fixedKey
    )

    expect(ctx.calls).toHaveLength(1)
    const { url, init } = ctx.calls[0]!
    expect(url).toBe("https://api.test/v1/orders")
    expect(init.method).toBe("POST")
    const headers = init.headers as Record<string, string>
    expect(headers.Authorization).toBe(`Bearer ${TEST_ACCESS_TOKEN}`)
    expect(headers["Content-Type"]).toBe("application/json")
    expect(headers["X-Idempotency-Key"]).toBe(ctx.fixedKey)
    expect(JSON.parse(String(init.body))).toEqual({
      type: "point",
      external_reference: "pos-charge-1",
      transactions: { payments: [{ amount: "10.00" }] },
      config: { point: { terminal_id: "NEWLAND_N950__SBX0000001" } },
    })
  })

  it("campos opcionais entram só quando fornecidos", async () => {
    await ctx.client.createPointOrder(
      {
        amount: "1.50",
        externalReference: "pos-charge-2",
        terminalId: "NEWLAND_N950__SBX0000001",
        expirationTime: "PT5M",
        printOnTerminal: "seller_ticket",
        paymentMethodDefaultType: "qr",
        description: "Venda balcão",
      },
      ctx.fixedKey
    )
    expect(JSON.parse(String(ctx.calls[0]!.init.body))).toEqual({
      type: "point",
      external_reference: "pos-charge-2",
      expiration_time: "PT5M",
      transactions: { payments: [{ amount: "1.50" }] },
      config: {
        point: {
          terminal_id: "NEWLAND_N950__SBX0000001",
          print_on_terminal: "seller_ticket",
        },
        payment_method: { default_type: "qr" },
      },
      description: "Venda balcão",
    })
  })
})

describe("MercadoPagoOrdersClient — getOrder", () => {
  it("GET /v1/orders/:id com encode e sem idempotency key", async () => {
    const { client, calls } = makeClient()
    await client.getOrder("ORD 9")
    expect(calls[0]!.url).toBe("https://api.test/v1/orders/ORD%209")
    expect(calls[0]!.init.method).toBe("GET")
    expect(
      (calls[0]!.init.headers as Record<string, string>)["X-Idempotency-Key"]
    ).toBeUndefined()
  })

  it("estados terminais do contrato (failed, action_required) parseiam sem erro", async () => {
    for (const status of ["failed", "action_required"] as const) {
      const { client } = makeClient([{ id: "ORD-1", status, type: "point" }])
      const order = await client.getOrder("ORD-1")
      expect(order.status).toBe(status)
    }
  })
})
