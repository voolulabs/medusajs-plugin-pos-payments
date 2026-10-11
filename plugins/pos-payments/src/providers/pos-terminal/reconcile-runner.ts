/**
 * Runner puro da conciliação periódica (A7/W2.2): decisões sem tocar container.
 * Alvo da aresta: refund originado no terminal cuja reconciliação esgotou as
 * tentativas do event bus (core 2.19: `attempts: 3`) — drift silencioso
 * (Medusa capturado, MP estornado).
 *
 * A varredura é PAYMENT-FIRST: o estado do charge ("paid" na captura,
 * "refunded" no refund) é gravado por mpCapture/mpRefund no blob que o core
 * persiste em `payment.data` — a sessão fica com o blob do initiate. Payment
 * já conciliado sai sozinho do conjunto (state vira "refunded" no refund do
 * core → mpRefund), e a janela temporal do job limita o crescimento.
 */
import type { PosPaymentsAdapter } from "../../adapters/types"
import { reconcileTerminalRefund } from "./webhook-reconcile"
import type { PaymentLike } from "./webhook-reconcile"

export type CapturedPaymentRow = {
  id: string
  sessionId: string
  chargeId: string
}

type RunnerDeps = {
  getAdapter(): PosPaymentsAdapter | undefined
  /** Pagos no Medusa (payment.data.state === "paid"), na janela do job. */
  listCapturedPayments(): Promise<CapturedPaymentRow[]>
  findPaymentByPaymentId(paymentId: string): Promise<PaymentLike | undefined>
  refundTotal(paymentId: string): Promise<unknown>
  /** Logger do core aceita meta winston em runtime; o tipo do framework é estreito. */
  logger: {
    info(msg: string, meta?: Record<string, unknown>): void
    warn(msg: string, meta?: Record<string, unknown>): void
  }
}

type ReconcileOutcome =
  | { paymentId: string; chargeId: string; action: "refunded" }
  | { paymentId: string; chargeId: string; action: "noop" }
  | { paymentId: string; chargeId: string; action: "skipped"; motivo: string }

export function createReconcileRunner(deps: RunnerDeps) {
  return async (): Promise<ReconcileOutcome[]> => {
    const adapter = deps.getAdapter()
    if (!adapter) return []
    const payments = await deps.listCapturedPayments()
    const outcomes: ReconcileOutcome[] = []
    for (const payment of payments) {
      const base = { paymentId: payment.id, chargeId: payment.chargeId }
      try {
        const fetched = await adapter.getCharge(payment.chargeId)
        // Divergência é anomalia (o charge da MP aponta para OUTRA sessão):
        // fail-closed — warn, skip, SEM refund (reembolsar poderia estornar
        // cobrança de outra sessão). Só ausência do eco alimenta o vínculo
        // local (payment_session_id é a coluna autoritativa — ADR 0007).
        if (
          fetched.externalReference !== undefined &&
          fetched.externalReference !== payment.sessionId
        ) {
          deps.logger.warn(
            "mercadopago: conciliação pulada — charge da adquirente aponta para outra sessão",
            {
              payment_id: payment.id,
              session_id: payment.sessionId,
              charge_id: payment.chargeId,
              external_reference: fetched.externalReference,
            }
          )
          outcomes.push({
            ...base,
            action: "skipped",
            motivo: "external_reference divergente",
          })
          continue
        }
        const view =
          fetched.externalReference === undefined
            ? ({
                ...fetched,
                externalReference: payment.sessionId,
              } as typeof fetched)
            : fetched
        const outcome = await reconcileTerminalRefund(view, {
          findPaymentBySession: async () =>
            deps.findPaymentByPaymentId(payment.id),
          refundTotal: deps.refundTotal,
        })
        if (outcome.action === "refunded") {
          deps.logger.info(
            "mercadopago: conciliação periódica reembolsou payment (refund de terminal perdido no event bus)",
            {
              payment_id: payment.id,
              session_id: payment.sessionId,
              charge_id: payment.chargeId,
            }
          )
          outcomes.push({ ...base, action: "refunded" })
        } else {
          outcomes.push({ ...base, ...outcome })
        }
      } catch (error) {
        // Um payment falho não derruba a varredura — a próxima execução do
        // cron re-tenta (job idempotente pela guarda do payment no Medusa).
        deps.logger.warn(
          "mercadopago: conciliação periódica falhou para o payment",
          {
            payment_id: payment.id,
            charge_id: payment.chargeId,
            detail: String(error).slice(0, 160),
          }
        )
        outcomes.push({
          ...base,
          action: "skipped",
          motivo: "erro de consulta",
        })
      }
    }
    return outcomes
  }
}

/** Recorte do alvo A7 em memória: capturado (`paid` via mpCapture) com charge
 * id — JSONB não é filtrável no módulo (ADR 0002). */
export function toCapturedPayment(row: {
  id: string
  payment_session_id: string
  data: { charge_id?: unknown; state?: unknown }
}): CapturedPaymentRow | undefined {
  if (row.data?.state !== "paid") return
  if (typeof row.data.charge_id !== "string" || !row.data.charge_id) return
  return {
    id: row.id,
    sessionId: row.payment_session_id,
    chargeId: row.data.charge_id,
  }
}
