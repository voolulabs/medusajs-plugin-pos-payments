import { describe, expect, it } from "vitest"
import { resolveAdapter } from "../index"
import { MercadoPagoAdapter } from "../mercadopago/adapter"

describe("resolveAdapter (falha alta — CONSTRAINTS 4)", () => {
  it("manual não tem adapter (comportamento legado intacto)", () => {
    expect(resolveAdapter("manual", {})).toBeUndefined()
  })

  it("mercadopago sem credencial falha alto", () => {
    expect(() => resolveAdapter("mercadopago", {})).toThrow(/accessToken/)
  })

  it("mercadopago com credencial devolve adapter da interface", () => {
    const adapter = resolveAdapter("mercadopago", {
      accessToken: "test-token-fixture",
    })
    expect(adapter).toBeInstanceOf(MercadoPagoAdapter)
    expect(adapter!.acquirer).toBe("mercadopago")
  })

  it("adquirente desconhecida falha no boot", () => {
    expect(() => resolveAdapter("sumup", { accessToken: "x" })).toThrow(
      /suportada/
    )
  })
})
