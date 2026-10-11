import { describe, expect, it } from "vitest"
import { mapOrderStatus, type ChargeStatusView } from "../status"
import { RETRY_TAXONOMY, UNKNOWN_DETAIL } from "../status-taxonomy"
import { MpContractError, type MpOrder, type MpOrderPayment } from "../types"

function comTransacao(detail?: string, status?: string): Partial<MpOrder> {
  const payment: MpOrderPayment = { id: "PAY-1", amount: "10.00" }
  if (detail !== undefined) payment.status_detail = detail
  if (status !== undefined) payment.status = status
  return { transactions: { payments: [payment] } }
}

function falha(extra: Partial<MpOrder>): MpOrder {
  return { id: "ORD-1", status: "failed", ...extra }
}

describe("falha com taxonomia da transação", () => {
  it.each([
    ["insufficient_amount", "retry_with_change"],
    ["rejected_by_issuer", "not_retryable"],
    ["high_risk", "not_retryable"],
    ["in_review", "escalate"],
  ] as const)("mapea %s para %s com copy", (detail, classe) => {
    const view: ChargeStatusView = mapOrderStatus(falha(comTransacao(detail)))
    expect(view.state).toBe("failed")
    expect(view.reasonCode).toBe(detail)
    expect(view.retryClass).toBe(classe)
    expect(view.reason).toBe(RETRY_TAXONOMY[detail]!.copy)
  })

  it("expõe rawStatus e o id do pagamento para o wiring", () => {
    const view = mapOrderStatus(falha(comTransacao("processing_error")))
    expect(view.rawStatus).toBe("failed")
    expect(view.paymentId).toBe("PAY-1")
  })

  it("detail desconhecido degrada conservador preservando o código", () => {
    const view = mapOrderStatus(falha(comTransacao("issuer_novo_2077")))
    expect(view.retryClass).toBe(UNKNOWN_DETAIL.retryClass)
    expect(view.reasonCode).toBe("issuer_novo_2077")
    expect(view.reason).toBe(UNKNOWN_DETAIL.copy)
  })

  it("detail herdado de protótipo degrada em vez de herdar entrada", () => {
    const view = mapOrderStatus(falha(comTransacao("constructor")))
    expect(view.retryClass).toBe(UNKNOWN_DETAIL.retryClass)
    expect(view.reasonCode).toBe("constructor")
  })

  it("failed sem transações usa o status como código e não quebra", () => {
    const view = mapOrderStatus(falha({}))
    expect(view.reasonCode).toBe("failed")
    expect(view.retryClass).toBe(UNKNOWN_DETAIL.retryClass)
    expect(view.reason!.length).toBeGreaterThan(0)
  })

  it("mais de um pagamento por ordem é violação de contrato", () => {
    const pagamentos = [
      { id: "PAY-1", amount: "5.00" },
      { id: "PAY-2", amount: "5.00" },
    ]
    expect(() =>
      mapOrderStatus(falha({ transactions: { payments: pagamentos } }))
    ).toThrow(MpContractError)
  })

  it("cardinalidade vale antes do ramo: processed com 2 pagamentos também lança", () => {
    const pagamentos = [
      { id: "PAY-1", amount: "5.00" },
      { id: "PAY-2", amount: "5.00" },
    ]
    const ordem: MpOrder = {
      id: "ORD-1",
      status: "processed",
      transactions: { payments: pagamentos },
    }
    expect(() => mapOrderStatus(ordem)).toThrow(MpContractError)
  })
})
