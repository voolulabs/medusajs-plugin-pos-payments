/** Mapeamento puro order → estado do charge. Type-aware (point vs qr) e fail-closed. */
import { QR_FORBIDDEN_STATUSES, type RetryClass } from "./status-taxonomy"
import { decimalToMinorUnits } from "./money"
import { cancelView, failureView, singlePayment } from "./status-view"
import type { ChargeState, ChargeStatusView } from "../types"
import { MpContractError, type MpOrder, type MpOrderStatus } from "./types"

export type { ChargeStatusView } from "../types"

/** Decisão: NENHUM estado MP produz "processing" no v1 — o poll não sintetiza otimismo. */
const STATE_BY_STATUS: Record<MpOrderStatus, ChargeState> = {
  created: "pending",
  at_terminal: "awaiting_terminal",
  processed: "paid",
  canceled: "canceled",
  expired: "expired",
  action_required: "action_required",
  failed: "failed",
  refunded: "refunded",
}

/** Guardas fail-closed pré-mapeamento: status conhecido, type no escopo, 1 pagamento. */
function assertMappable(order: MpOrder): void {
  // hasOwnProperty e não `in`: chaves herdadas de Object.prototype não passam.
  if (!Object.prototype.hasOwnProperty.call(STATE_BY_STATUS, order.status)) {
    throw new MpContractError(
      `status de ordem desconhecido: ${String(order.status)}`
    )
  }
  // type ausente = point (decisão da spec); "online" e afins estão fora do escopo presencial.
  if (
    order.type !== undefined &&
    order.type !== "point" &&
    order.type !== "qr"
  ) {
    throw new MpContractError(
      `tipo de ordem fora do escopo: ${order.type} (ordem ${order.id})`
    )
  }
  if (order.type === "qr" && QR_FORBIDDEN_STATUSES.has(order.status)) {
    throw new MpContractError(
      `status ${order.status} não existe na máquina qr (ordem ${order.id})`
    )
  }
  // TODOS os estados exigem o contrato de 1 pagamento.
  const payments = order.transactions?.payments ?? []
  if (payments.length > 1) {
    throw new MpContractError(
      `ordem ${order.id} tem ${payments.length} pagamentos (contrato: 1)`
    )
  }
}

export function mapOrderStatus(order: MpOrder): ChargeStatusView {
  assertMappable(order)
  const state = STATE_BY_STATUS[order.status]
  const eco = {
    ...(order.external_reference !== undefined
      ? { externalReference: order.external_reference }
      : {}),
  }
  if (state === "failed") {
    return { ...eco, ...failureView(order) }
  }
  if (state === "canceled") {
    return { ...eco, ...cancelView(order) }
  }
  if (state === "action_required") {
    // Doc oficial: action_required é ABSORVENTE no nível da order ("will not
    // change") — quem confirma o resultado é a TRANSAÇÃO.
    const payment = singlePayment(order)
    if (
      payment?.status === "processed" ||
      payment?.status_detail === "accredited"
    ) {
      return paidView(eco, order.status, payment)
    }
    return {
      ...eco,
      state,
      rawStatus: order.status,
      paymentId: payment?.id,
      reason: "Verifique o terminal para confirmar o resultado do pagamento.",
    }
  }
  if (state === "paid") {
    return paidView(eco, order.status, singlePayment(order))
  }
  const payment = singlePayment(order)
  // Errata 2026-10-07 (docs .mx, E3/E9): o 202 do cancel deixa a ordem
  // at_terminal com cancellation_requested na transação — o cancelamento está
  // SOLICITADO, não concluído: o terminal pode priorizar a cobrança e a
  // captura ainda acontecer. Poll e cancel compartilham este caminho.
  if (
    state === "awaiting_terminal" &&
    payment?.status_detail === "cancellation_requested"
  ) {
    return {
      ...eco,
      state,
      rawStatus: order.status,
      paymentId: payment.id,
      cancelRequested: true,
    }
  }
  return {
    ...eco,
    state,
    rawStatus: order.status,
    paymentId: payment?.id,
  }
}

/**
 * View paid: ÚNICO consumidor de amountMinor (ação captured do webhook).
 * Converter amount fora daqui transformaria um valor malformado em falha de
 * mapeamento de estados que nem usam o número — inclusive pós-refund na MP,
 * quando o estorno JÁ aconteceu e o resultado tem que persistir.
 */
function paidView(
  eco: { externalReference?: string },
  rawStatus: MpOrderStatus,
  payment: ReturnType<typeof singlePayment>
): ChargeStatusView {
  return {
    ...eco,
    ...(payment?.amount !== undefined
      ? { amountMinor: decimalToMinorUnits(payment.amount) }
      : {}),
    state: "paid",
    rawStatus,
    paymentId: payment?.id,
  }
}
