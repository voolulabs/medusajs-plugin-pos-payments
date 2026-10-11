import { describe, expect, it } from "vitest"
import PosTerminalProviderService from "../service"
import { mergeSessionData } from "../schema"

const service = new PosTerminalProviderService({ logger: console } as never, {
  acquirer: "manual",
})

describe("PosTerminalProviderService (métodos de estado)", () => {
  it("deletePayment limpa o estado", async () => {
    const out = await service.deletePayment({
      data: { captured_at: "t" },
    } as never)
    expect(out.data).toEqual({})
  })

  it.each(["__proto__", "constructor", "prototype"] as const)(
    "updatePayment rejeita chave proibida (%s)",
    async (key) => {
      await expect(
        service.updatePayment({
          amount: 100,
          currency_code: "brl",
          data: { a: 1, [key]: { x: 1 } },
        } as never)
      ).rejects.toThrow(`proibida no data: ${key}`)
    }
  )

  it("updatePayment ecoa o data válido", async () => {
    const out = await service.updatePayment({
      amount: 100,
      currency_code: "brl",
      data: { a: 1 },
    })
    expect(out.data).toEqual({ a: 1 })
  })

  it("mergeSessionData é depth-1 por own-properties", () => {
    const merged = { ...mergeSessionData({ a: 1 }, { b: 2 }) }
    expect(merged).toEqual({ a: 1, b: 2 })
  })

  it("mergeSessionData: chave duplicada — o patch vence", () => {
    const merged = { ...mergeSessionData({ a: 1, b: 1 }, { a: 2 }) }
    expect(merged).toEqual({ a: 2, b: 1 })
  })

  it("getWebhookActionAndData devolve not_supported (Fase 1)", async () => {
    const out = await service.getWebhookActionAndData({
      data: {},
      rawData: Buffer.from("{}"),
      headers: {},
    })
    expect(out.action).toBe("not_supported")
  })
})
