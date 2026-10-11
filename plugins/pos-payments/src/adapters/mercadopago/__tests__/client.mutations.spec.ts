import { describe, expect, it } from "vitest"
import { makeClient } from "./helpers"
import { cancelOrder, refundOrder } from "../orders"

describe("cancel/refund — idempotência explícita e header do contrato", () => {
  it("cancelOrder faz POST /cancel com a chave recebida", async () => {
    const { client, calls, fixedKey } = makeClient()
    await cancelOrder(client, "ORD-1", fixedKey)
    expect(calls[0]!.url).toBe("https://api.test/v1/orders/ORD-1/cancel")
    expect(
      (calls[0]!.init.headers as Record<string, string>)["X-Idempotency-Key"]
    ).toBe(fixedKey)
  })

  it("header x-allow-cancelable-status vai SEMPRE (contrato 2026-10-07: ignorado em created, exigido em at_terminal)", async () => {
    const { client, calls, fixedKey } = makeClient()
    await cancelOrder(client, "ORD-1", fixedKey)
    expect(
      (calls[0]!.init.headers as Record<string, string>)[
        "x-allow-cancelable-status"
      ]
    ).toBe("at_terminal")
  })

  it("a decisão do header saiu da chamada — assinatura sem options", () => {
    // Header incondicional (D2a): a camada MP decide, o chamador não opina.
    expect(cancelOrder).toHaveLength(3)
  })

  it("refundOrder faz POST /refund com a chave recebida e sem body", async () => {
    const { client, calls, fixedKey } = makeClient()
    await refundOrder(client, "ORD-1", fixedKey)
    expect(calls[0]!.url).toBe("https://api.test/v1/orders/ORD-1/refund")
    expect(
      (calls[0]!.init.headers as Record<string, string>)["X-Idempotency-Key"]
    ).toBe(fixedKey)
    expect(calls[0]!.init.body).toBeUndefined()
  })

  it("retry de create reutiliza a MESMA chave (idempotência estável)", async () => {
    const { client, calls, fixedKey } = makeClient()
    const input = {
      amount: "1.00",
      externalReference: "pos-charge-1",
      terminalId: "NEWLAND_N950__S1",
    } as const
    await client.createPointOrder(input, fixedKey)
    await client.createPointOrder(input, fixedKey)
    expect(calls).toHaveLength(2)
    for (const call of calls) {
      expect(
        (call.init.headers as Record<string, string>)["X-Idempotency-Key"]
      ).toBe(fixedKey)
    }
  })
})
