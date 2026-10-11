/** Construtores de view para os estados que carregam motivo (failed/canceled). */
import {
  CANCEL_ORIGINS,
  RETRY_TAXONOMY,
  UNKNOWN_DETAIL,
} from "./status-taxonomy"
import type { ChargeStatusView } from "./status"
import type { MpOrder, MpOrderPayment } from "./types"

/** Pagamento único da ordem — a cardinalidade é garantida por assertMappable (status.ts). */
export function singlePayment(order: MpOrder): MpOrderPayment | undefined {
  return order.transactions?.payments?.[0]
}

export function failureView(order: MpOrder): ChargeStatusView {
  const payment = singlePayment(order)
  const detail = payment?.status_detail
  // hasOwnProperty: detail herdado ("constructor") não vira entrada da tabela.
  const entry =
    (detail !== undefined &&
      Object.prototype.hasOwnProperty.call(RETRY_TAXONOMY, detail) &&
      RETRY_TAXONOMY[detail]) ||
    UNKNOWN_DETAIL
  return {
    state: "failed",
    rawStatus: order.status,
    paymentId: payment?.id,
    reasonCode: detail ?? order.status,
    retryClass: entry.retryClass,
    reason: entry.copy,
  }
}

export function cancelView(order: MpOrder): ChargeStatusView {
  const payment = singlePayment(order)
  // Tabela oficial: a origem vive no status_detail da transação (status é "canceled");
  // aceita também no status, por tolerância documentada.
  const origin = [payment?.status_detail, payment?.status].find(
    (value) => value !== undefined && CANCEL_ORIGINS.has(value)
  )
  const base: ChargeStatusView = {
    state: "canceled",
    rawStatus: order.status,
    paymentId: payment?.id,
    reason: "Cobrança cancelada.",
  }
  if (origin === undefined) return base
  return {
    ...base,
    reasonCode: origin,
    reason:
      origin === "canceled_on_terminal"
        ? "Cobrança cancelada no terminal."
        : "Cobrança cancelada.",
  }
}
