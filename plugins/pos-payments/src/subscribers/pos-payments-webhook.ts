/** Subscriber do plugin: reconcilia refund originado no terminal (T5, ADR 0007). */
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { refundPaymentWorkflow } from "@medusajs/medusa/core-flows"
import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import type { PosPaymentsAdapter } from "../adapters/types"
import { resolveAdapter } from "../adapters"
import { getPluginOptions } from "../utils/plugin-options"
import { parseEnvelope } from "../providers/pos-terminal/service-webhook"
import { validateWebhookSignature } from "../providers/pos-terminal/webhook-signature"
import { reconcileTerminalRefund } from "../providers/pos-terminal/webhook-reconcile"

type WebhookEvent = {
  provider: string
  payload: {
    data: Record<string, unknown>
    /** O event bus persistido entrega o Buffer serializado (mesma forma que o
     * subscriber do core re-hidrata antes de chamar o provider). */
    rawData: Buffer | { type: string; data: number[] }
    headers: Record<string, string>
  }
}

type SessionPayment = {
  id: string
  captured_at?: string | null
  refunds?: { id: string }[] | null
}

/** Re-hidrata o Buffer serializado do event bus (idempotente p/ Buffer real). */
function coerceRawData(raw: WebhookEvent["payload"]["rawData"]): Buffer {
  if (Buffer.isBuffer(raw)) return raw
  return Array.isArray(raw?.data) ? Buffer.from(raw.data) : Buffer.alloc(0)
}

type HandlerDeps = {
  getAdapter(): PosPaymentsAdapter | undefined
  getSecret(): string
  logger: {
    warn(msg: string, ctx?: Record<string, unknown>): void
    info(msg: string, ctx?: Record<string, unknown>): void
  }
  findPaymentBySession(sessionId: string): Promise<SessionPayment | undefined>
  refundTotal(paymentId: string): Promise<unknown>
}

/** Formas do id do provider no evento (L3 2026-10-05): o core 2.19 prefixa
 * `pp_` INCONDICIONALMENTE ao path param no roteamento do webhook — a URL
 * registrada no painel MP tem que ser sans-pp e o evento chega na forma do
 * path (doc oficial: o path já prefixado só é aceito a partir da 2.21.2 —
 * manter a URL sans `pp_`). O Set cobre as duas formas por robustez; ids de
 * outros providers continuam de fora. */
const PROVIDER_EVENT_IDS = new Set([
  "pp_pos-terminal_mercadopago",
  "pos-terminal_mercadopago",
])

/** Fiação testável: as dependências vêm de fora (nada de mock de módulo). */
export function createHandler(deps: HandlerDeps) {
  return async ({ event }: { event: { data: WebhookEvent } }) => {
    if (!PROVIDER_EVENT_IDS.has(event.data.provider)) return
    const adapter = deps.getAdapter()
    if (!adapter) return
    const payload = event.data.payload
    const { id } = parseEnvelope(coerceRawData(payload.rawData))
    const assinado =
      id !== undefined &&
      validateWebhookSignature(
        payload.headers,
        { data: { id } },
        deps.getSecret()
      )
    if (!assinado) {
      deps.logger.warn("mercadopago: reconciliacao descartada (assinatura)", {
        provider_id: event.data.provider,
        charge_id: id ?? "ausente",
      })
      return
    }
    try {
      const view = await adapter.getCharge(id!)
      // A1.7/MC2: cancelado é desfecho esperado (terminal ou caixa) — o core
      // descarta canceled (payment-webhook 2.19) e aqui não há refund a
      // criar. Noop com log info, não WARN.
      if (view.state === "canceled") {
        deps.logger.info(
          "mercadopago: cobranca cancelada no terminal — nada a reconciliar",
          {
            provider_id: event.data.provider,
            charge_id: id,
          }
        )
        return
      }
      const outcome = await reconcileTerminalRefund(view, {
        findPaymentBySession: deps.findPaymentBySession,
        refundTotal: deps.refundTotal,
      })
      if (outcome.action === "skipped") {
        deps.logger.warn("mercadopago: reconciliacao pulada", {
          provider_id: event.data.provider,
          charge_id: id,
          motivo: outcome.motivo,
        })
      }
    } catch (error) {
      deps.logger.warn("mercadopago: reconciliacao falhou", {
        provider_id: event.data.provider,
        charge_id: id,
        detail: String(error).slice(0, 160),
      })
      // Re-lança: falha transitória (re-fetch, workflow) tem que consumir as
      // tentativas do event bus — a reconciliação é o único caminho do refund
      // de terminal. Falhas permanentes (assinatura, sessão) nunca chegam aqui.
      throw error
    }
  }
}

export default async function posPaymentsWebhook({
  event,
  container,
}: SubscriberArgs<WebhookEvent>) {
  const options = getPluginOptions(container as never)
  const posTerminal = options.posTerminal
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const run = createHandler({
    // Lazy: o adapter resolve SÓ para eventos do nosso provider — options
    // quebradas (sem accessToken) não podem derrubar webhooks de outros
    // providers no event bus.
    getAdapter: () =>
      posTerminal?.acquirer === "mercadopago"
        ? resolveAdapter("mercadopago", {
            accessToken: posTerminal.accessToken,
            ...(posTerminal.fetchImpl
              ? { fetchImpl: posTerminal.fetchImpl }
              : {}),
          })
        : undefined,
    getSecret: () => posTerminal?.webhookSecret ?? "",
    logger,
    findPaymentBySession: async (sessionId) => {
      const { data } = await query.graph({
        entity: "payment",
        fields: ["id", "captured_at", "refunds.id"],
        // session_id do action = id da payment session (subscriber do core);
        // a coluna do payment é payment_session_id (única, índice parcial).
        filters: { payment_session_id: sessionId },
      })
      return data[0] as SessionPayment | undefined
    },
    refundTotal: async (paymentId) => {
      // Idempotência no engine: redelivery do event bus com a mesma chave não
      // re-executa o workflow concluído (a guarda de refunds do payment cobre
      // os casos posteriores). NÃO garante exclusão mútua entre execuções
      // concorrentes: risco residual aceito no T5 (ledger seq 90), revisão
      // com locking no T6. O transactionId existe no engine
      // (WorkflowOrchestratorRunDTO) mas o FlowRunOptions do sdk ainda não o
      // expõe — cast local.
      await refundPaymentWorkflow(container).run({
        input: { payment_id: paymentId },
        transactionId: `pos-payments-reconcile:${paymentId}`,
      } as never)
    },
  })
  await run({ event })
}

export const config: SubscriberConfig = {
  event: "payment.webhook_received",
}
