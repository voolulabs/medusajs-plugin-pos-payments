import { describe, expect, it, vi } from "vitest"
import {
  reconcileTerminalRefund,
  type ReconcileDeps,
} from "../webhook-reconcile"

function deps(overrides?: Partial<ReconcileDeps>): ReconcileDeps {
  return {
    findPaymentBySession: vi.fn(async () => ({
      id: "pay_1",
      captured_at: "2026-10-04T12:00:00Z",
    })),
    refundTotal: vi.fn(async () => undefined),
    ...overrides,
  }
}

const refunded = {
  state: "refunded",
  rawStatus: "refunded",
  externalReference: "ps_1",
} as const

describe("reconcileTerminalRefund (T5 — refund originado no terminal)", () => {
  it("estados que o core processa são no-op", async () => {
    const d = deps()
    await expect(
      reconcileTerminalRefund({ state: "paid", rawStatus: "processed" }, d)
    ).resolves.toEqual({ action: "noop" })
    expect(d.refundTotal).not.toHaveBeenCalled()
  })

  it("refunded com sessão válida e sem refunds → refund TOTAL 1x", async () => {
    const d = deps()
    const outcome = await reconcileTerminalRefund(refunded, d)
    expect(outcome).toEqual({ action: "refunded", paymentId: "pay_1" })
    expect(d.findPaymentBySession).toHaveBeenCalledWith("ps_1")
    expect(d.refundTotal).toHaveBeenCalledTimes(1)
    expect(d.refundTotal).toHaveBeenCalledWith("pay_1")
  })

  it("idempotente: entrega repetida pula (payment já tem refund)", async () => {
    const d = deps({
      findPaymentBySession: vi.fn(async () => ({
        id: "pay_1",
        captured_at: "2026-10-04T12:00:00Z",
        refunds: [{ id: "re_1" }],
      })),
    })
    const outcome = await reconcileTerminalRefund(refunded, d)
    expect(outcome).toEqual({ action: "skipped", motivo: "ja reembolsado" })
    expect(d.refundTotal).not.toHaveBeenCalled()
  })

  it("payment não capturado (refund antes do markAsPaid) → skip, sem workflow", async () => {
    const d = deps({
      findPaymentBySession: vi.fn(async () => ({
        id: "pay_1",
        captured_at: null,
        refunds: [],
      })),
    })
    const outcome = await reconcileTerminalRefund(refunded, d)
    expect(outcome).toEqual({ action: "skipped", motivo: "nao capturado" })
    expect(d.refundTotal).not.toHaveBeenCalled()
  })

  it("sem external_reference ou sessão inexistente → skip com motivo", async () => {
    const d = deps()
    await expect(
      reconcileTerminalRefund({ state: "refunded", rawStatus: "refunded" }, d)
    ).resolves.toEqual({ action: "skipped", motivo: "sem external_reference" })
    await expect(
      reconcileTerminalRefund(
        refunded,
        deps({ findPaymentBySession: vi.fn(async () => undefined) })
      )
    ).resolves.toEqual({ action: "skipped", motivo: "sessao nao encontrada" })
  })
})
