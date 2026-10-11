import { describe, expect, it } from "vitest"
import { mapOrderStatus } from "../status"
import { MpContractError, type MpOrder, type MpOrderStatus } from "../types"

function order(status: MpOrderStatus, extra?: Partial<MpOrder>): MpOrder {
  return { id: "ORD-1", status, ...extra }
}

function comDetail(detail: string): Partial<MpOrder> {
  return {
    transactions: {
      payments: [{ id: "PAY-1", amount: "1.00", status_detail: detail }],
    },
  }
}

describe("máquina point (8 estados)", () => {
  it.each([
    ["created", "pending"],
    ["at_terminal", "awaiting_terminal"],
    ["processed", "paid"],
    ["canceled", "canceled"],
    ["expired", "expired"],
    ["action_required", "action_required"],
    ["failed", "failed"],
    ["refunded", "refunded"],
  ] as const)("%s -> %s", (mp, charge) => {
    expect(mapOrderStatus(order(mp)).state).toBe(charge)
  })

  it("type ausente é tratado como point (decisão da spec)", () => {
    expect(mapOrderStatus(order("at_terminal")).state).toBe("awaiting_terminal")
  })

  it("estados neutros não carregam motivo, mas expõem rawStatus", () => {
    const view = mapOrderStatus(order("expired", comDetail("high_risk")))
    expect("reasonCode" in view).toBe(false)
    expect("reason" in view).toBe(false)
    expect(view.rawStatus).toBe("expired")
  })

  it("action_required com transação creditada vira paid (order é absorvente)", () => {
    const view = mapOrderStatus(
      order("action_required", {
        transactions: {
          payments: [{ id: "PAY-1", amount: "1.00", status: "processed" }],
        },
      })
    )
    expect(view.state).toBe("paid")
    expect(view.paymentId).toBe("PAY-1")
  })

  it("status da order prevalece sobre detail de recusa na transação", () => {
    const view = mapOrderStatus(order("processed", comDetail("high_risk")))
    expect(view.state).toBe("paid")
    expect("reason" in view).toBe(false)
  })

  it("action_required orienta conferir o terminal (estado terminal na doc)", () => {
    const view = mapOrderStatus(order("action_required"))
    expect(view.state).toBe("action_required")
    expect(view.reason).toContain("Verifique o terminal")
    expect("reasonCode" in view).toBe(false)
  })

  it("nenhum estado MP produz processing", () => {
    const estados = [
      "created",
      "at_terminal",
      "processed",
      "canceled",
      "expired",
      "action_required",
      "failed",
      "refunded",
    ] as const
    for (const s of estados)
      expect(mapOrderStatus(order(s)).state).not.toBe("processing")
  })
})

describe("eco do re-fetch (externalReference/amountMinor)", () => {
  const comRef = { external_reference: "ps_1" }
  const comPagamento = {
    ...comRef,
    transactions: { payments: [{ id: "PAY-1", amount: "50.00" }] },
  }

  it("paid carrega amountMinor; demais estados só ecoam a referência", () => {
    expect(mapOrderStatus(order("processed", comPagamento))).toMatchObject({
      state: "paid",
      externalReference: "ps_1",
      amountMinor: 5000,
    })
    const refundada = mapOrderStatus(order("refunded", comPagamento))
    expect(refundada.externalReference).toBe("ps_1")
    expect(refundada.amountMinor).toBeUndefined()
  })

  it("amount malformado NÃO derruba estados que não usam o valor", () => {
    const quebrado = {
      ...comRef,
      transactions: { payments: [{ id: "PAY-1", amount: "50.005" }] },
    }
    expect(() => mapOrderStatus(order("processed", quebrado))).toThrow(
      MpContractError
    )
    expect(mapOrderStatus(order("refunded", quebrado)).state).toBe("refunded")
    expect(mapOrderStatus(order("failed", quebrado)).state).toBe("failed")
    expect(mapOrderStatus(order("canceled", quebrado)).state).toBe("canceled")
  })
})
