import { MedusaError } from "@medusajs/framework/utils"
import { describe, expect, it } from "vitest"
import PosTerminalProviderService from "../service"

// Guardas de estado e fronteira do data (review 2026-09-29, deve 1 e 2;
// tipo do erro assertado além da mensagem — CodeRabbit PR #4).
// Arquivo separado do service.unit.spec: opcore complexity.max-function-lines
// (100) — a suíte de contrato ficou acima do teto com os guardas juntos.
const service = new PosTerminalProviderService({ logger: console } as never, {
  acquirer: "manual",
})

describe("PosTerminalProviderService (guardas)", () => {
  it("capturePayment rejeita cobrança cancelada (UNEXPECTED_STATE)", async () => {
    await expect(
      service.capturePayment({ data: { canceled_at: "t" } } as never)
    ).rejects.toMatchObject({
      type: MedusaError.Types.UNEXPECTED_STATE,
      message: expect.stringMatching(/cancelada/),
    })
  })

  it("refundPayment rejeita cobrança cancelada (UNEXPECTED_STATE)", async () => {
    await expect(
      service.refundPayment({ data: { canceled_at: "t" } } as never)
    ).rejects.toMatchObject({
      type: MedusaError.Types.UNEXPECTED_STATE,
      message: expect.stringMatching(/cancelada/),
    })
  })

  it("cancelPayment rejeita cobrança já capturada (UNEXPECTED_STATE)", async () => {
    await expect(
      service.cancelPayment({ data: { captured_at: "t" } } as never)
    ).rejects.toMatchObject({
      type: MedusaError.Types.UNEXPECTED_STATE,
      message: expect.stringMatching(/capturada/),
    })
  })

  it("refundPayment espelha o amount deste reembolso e preserva o blob", async () => {
    const out = await service.refundPayment({
      data: { captured_at: "t", external_id: "x1" },
      amount: 1500,
    } as never)
    expect(out.data!["external_id"]).toBe("x1")
    expect(out.data!["last_refunded_amount"]).toBe(1500)
  })

  it("initiatePayment e authorizePayment rejeitam prototype na fronteira (INVALID_DATA)", async () => {
    await expect(
      service.initiatePayment({ data: { ["__proto__"]: { x: 1 } } } as never)
    ).rejects.toMatchObject({
      type: MedusaError.Types.INVALID_DATA,
      message: expect.stringMatching(/proibida/),
    })
    await expect(
      service.authorizePayment({ data: { ["constructor"]: 1 } } as never)
    ).rejects.toMatchObject({
      type: MedusaError.Types.INVALID_DATA,
      message: expect.stringMatching(/proibida/),
    })
  })
})
