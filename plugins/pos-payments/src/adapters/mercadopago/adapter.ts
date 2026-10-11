/** Adapter Mercado Pago da interface comum (usa o cliente T1 + status T2). */
import type {
  ChargeStatusView,
  CreateChargeInput,
  PosPaymentsAdapter,
  TerminalsListQuery,
  TerminalsPage,
} from "../types"
import { assertReusedOrder } from "./reuse-guard"
import { MercadoPagoOrdersClient } from "./client"
import { cancelOrder, refundOrderResilient } from "./orders"
import { mapOrderStatus } from "./status"
import { recoverByIdempotencyConflict } from "./search"
import { listTerminals as listTerminalsRemote } from "./terminals"
import { toTerminalsPage } from "./terminals-page"
import { toCreateOrderInput } from "./payload"
import { assertTerminalAllowedByMode } from "./test-mode"

interface MpAdapterOptions {
  accessToken: string
  fetchImpl?: typeof fetch
  /** Timeout duro por chamada — padrão 15s (orçamento do app de caixa). */
  timeoutMs?: number
  /** Guard MP_POINT_TEST_MODE (T6) — default false (produção); true só em homologação. */
  testMode?: boolean
}

/** Point captura no processamento: capture do adapter é confirmação LOCAL (sem POST). */
export class MercadoPagoAdapter implements PosPaymentsAdapter {
  readonly acquirer = "mercadopago"
  private readonly client: MercadoPagoOrdersClient
  private readonly testMode: boolean

  constructor(options: MpAdapterOptions) {
    this.testMode = options.testMode === true
    this.client = new MercadoPagoOrdersClient({
      accessToken: options.accessToken,
      ...(options.fetchImpl !== undefined
        ? { fetchImpl: options.fetchImpl }
        : {}),
      ...(options.timeoutMs !== undefined
        ? { timeoutMs: options.timeoutMs }
        : {}),
    })
  }

  async createCharge(
    input: CreateChargeInput,
    idempotencyKey: string
  ): Promise<{ chargeId: string; view: ChargeStatusView }> {
    // Guard T6: sandbox (serial SBX*) só passa com MP_POINT_TEST_MODE —
    // fail-closed ANTES de idempotência, payload e rede.
    assertTerminalAllowedByMode(input.terminalId, this.testMode)
    let order
    try {
      order = await this.client.createPointOrder(
        toCreateOrderInput(input),
        idempotencyKey
      )
    } catch (error) {
      // Colisão de idempotência: reconsulta por referência, nunca recria.
      order = await recoverByIdempotencyConflict(
        this.client,
        input.externalReference,
        error
      )
    }
    assertReusedOrder(order, input)
    return { chargeId: order.id, view: mapOrderStatus(order) }
  }

  async getCharge(chargeId: string): Promise<ChargeStatusView> {
    return mapOrderStatus(await this.client.getOrder(chargeId))
  }

  async cancelCharge(
    chargeId: string,
    idempotencyKey: string,
    // Interface comum mantém a assinatura p/ adapters futuros; a camada MP
    // decide o header sozinha (incondicional — errata 2026-10-07).
    _opts?: { allowAtTerminal?: boolean }
  ): Promise<ChargeStatusView> {
    return mapOrderStatus(
      await cancelOrder(this.client, chargeId, idempotencyKey)
    )
  }

  async refundCharge(
    chargeId: string,
    idempotencyKey: string
  ): Promise<ChargeStatusView> {
    // Contrato Point: estorno TOTAL — o provider recusa parcial ANTES de chamar.
    // Idempotente por estado: refund já aplicado no terminal (T5) volta como
    // sucesso — a decisão vem do re-fetch, não do corpo do erro (ADR 0001).
    return mapOrderStatus(
      await refundOrderResilient(this.client, chargeId, idempotencyKey)
    )
  }

  async listTerminals(query: TerminalsListQuery = {}): Promise<TerminalsPage> {
    return toTerminalsPage(await listTerminalsRemote(this.client, query))
  }
}
