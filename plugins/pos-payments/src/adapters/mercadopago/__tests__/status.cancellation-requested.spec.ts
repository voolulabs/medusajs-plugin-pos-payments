import { describe, expect, it } from "vitest"
import { mapOrderStatus } from "../status"
import type { MpOrder, MpOrderPayment } from "../types"

/** Ordem carregada no terminal (202 do cancel deixa a ordem AQUI, E3/E9). */
function ordemAtTerminal(detail?: string): MpOrder {
  const payment: MpOrderPayment = { id: "PAY-1", amount: "10.00" }
  if (detail !== undefined) payment.status_detail = detail
  return {
    id: "ORD-1",
    status: "at_terminal",
    type: "point",
    transactions: { payments: [payment] },
  }
}

describe("cancellation_requested na view (contrato 202 da Orders API)", () => {
  it("at_terminal + cancellation_requested → cancelRequested true (poll e cancel)", () => {
    const v = mapOrderStatus(ordemAtTerminal("cancellation_requested"))
    expect(v.state).toBe("awaiting_terminal")
    expect(v.cancelRequested).toBe(true)
  })

  it("at_terminal sem cancellation_requested → sem cancelRequested", () => {
    const v = mapOrderStatus(ordemAtTerminal())
    expect(v.state).toBe("awaiting_terminal")
    expect("cancelRequested" in v).toBe(false)
  })

  it("canceled NÃO marca cancelRequested (estado já é terminal)", () => {
    const v = mapOrderStatus({
      id: "ORD-1",
      status: "canceled",
      type: "point",
      transactions: {
        payments: [
          { id: "PAY-1", amount: "10.00", status_detail: "canceled_by_api" },
        ],
      },
    })
    expect(v.state).toBe("canceled")
    expect("cancelRequested" in v).toBe(false)
  })
})
