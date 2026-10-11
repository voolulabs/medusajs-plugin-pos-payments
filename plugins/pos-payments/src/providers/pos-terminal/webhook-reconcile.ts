/** Reconciliação do refund originado no terminal (T5) — decisão pura, deps injetadas. */
import type { ChargeStatusView } from "../../adapters/types"

export type PaymentLike = {
  id: string
  /** Ausente quando o caixa ainda não confirmou (markAsPaid) — sem captura no
   * Medusa não há o que reembolsar (refund de terminal antes do markAsPaid). */
  captured_at?: string | null
  refunds?: { id: string }[] | null
}

export type ReconcileDeps = {
  findPaymentBySession(sessionId: string): Promise<PaymentLike | undefined>
  refundTotal(paymentId: string): Promise<unknown>
}

type ReconcileOutcome =
  | { action: "noop" }
  | { action: "refunded"; paymentId: string }
  | { action: "skipped"; motivo: string }

/**
 * Idempotente: o refund acontece só na 1ª entrega — a guarda é o payment do
 * Medusa (refunds existentes), não o estado da MP (que já nasce refunded).
 */
export async function reconcileTerminalRefund(
  view: ChargeStatusView,
  deps: ReconcileDeps
): Promise<ReconcileOutcome> {
  if (view.state !== "refunded") return { action: "noop" }
  const sessionId = view.externalReference
  if (!sessionId) return { action: "skipped", motivo: "sem external_reference" }
  const payment = await deps.findPaymentBySession(sessionId)
  if (!payment) return { action: "skipped", motivo: "sessao nao encontrada" }
  if (payment.captured_at == null) {
    return { action: "skipped", motivo: "nao capturado" }
  }
  if ((payment.refunds ?? []).length > 0) {
    return { action: "skipped", motivo: "ja reembolsado" }
  }
  await deps.refundTotal(payment.id)
  return { action: "refunded", paymentId: payment.id }
}
