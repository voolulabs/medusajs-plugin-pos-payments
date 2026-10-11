import { describe, expect, it } from "vitest"
import { mapOrderStatus } from "../status"
import type { MpOrder, MpOrderPayment } from "../types"

function comTransacao(detail?: string, status?: string): Partial<MpOrder> {
  const payment: MpOrderPayment = { id: "PAY-1", amount: "10.00" }
  if (detail !== undefined) payment.status_detail = detail
  if (status !== undefined) payment.status = status
  return { transactions: { payments: [payment] } }
}

function cancelada(extra?: Partial<MpOrder>): MpOrder {
  return { id: "ORD-1", status: "canceled", ...extra }
}

describe("cancelamento e refund", () => {
  it("origem vem do status_detail da transação (tabela oficial)", () => {
    const api = mapOrderStatus(cancelada(comTransacao("canceled_by_api")))
    const terminal = mapOrderStatus(
      cancelada(comTransacao("canceled_on_terminal"))
    )
    expect(api.reasonCode).toBe("canceled_by_api")
    expect(api.reason).toContain("cancelada")
    expect(terminal.reasonCode).toBe("canceled_on_terminal")
    expect(terminal.reason).toContain("terminal")
  })

  it("tolera origem informada no status da transação", () => {
    const view = mapOrderStatus(
      cancelada(comTransacao(undefined, "canceled_by_api"))
    )
    expect(view.reasonCode).toBe("canceled_by_api")
  })

  it("cancelamento genérico (detail canceled) expõe o código", () => {
    const view = mapOrderStatus(cancelada(comTransacao("canceled")))
    expect(view.reasonCode).toBe("canceled")
    expect(view.reason).toContain("cancelada")
  })

  it("cancelado antes da tentativa: sem reasonCode, copy genérica", () => {
    const view = mapOrderStatus(cancelada())
    expect(view.state).toBe("canceled")
    expect("reasonCode" in view).toBe(false)
    expect(view.reason!.length).toBeGreaterThan(0)
  })

  it("refund (inclusive originado no terminal) expõe estado próprio", () => {
    const refund = mapOrderStatus({
      id: "ORD-1",
      status: "refunded",
      ...comTransacao(),
    })
    expect(refund.state).toBe("refunded")
    expect(refund.rawStatus).toBe("refunded")
  })
})
