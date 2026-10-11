import {
  MpContractError,
  type MpOrder,
  type CreatePointOrderInput,
} from "./types"
import { parseMpResponse } from "./response"
import {
  assertAmount,
  assertDescription,
  assertExternalReference,
  assertExpirationTime,
  assertTerminalId,
} from "./validation"
import { parseOrder } from "./schema"
import { buildCreateOrderBody } from "./payload"

const MP_API_BASE_URL = "https://api.mercadopago.com"
const DEFAULT_TIMEOUT_MS = 15_000

interface MercadoPagoOrdersClientOptions {
  accessToken: string
  baseUrl?: string
  fetchImpl?: typeof fetch
  /** Timeout duro por chamada (AbortSignal) — padrão 15s, orçamento do app de caixa. */
  timeoutMs?: number
}

export class MercadoPagoOrdersClient {
  private readonly baseUrl: string
  private readonly fetchImpl: typeof fetch
  private readonly timeoutMs: number

  constructor(private readonly options: MercadoPagoOrdersClientOptions) {
    if (!options.accessToken)
      throw new MpContractError("accessToken é obrigatório")
    this.baseUrl = options.baseUrl ?? MP_API_BASE_URL
    this.fetchImpl = options.fetchImpl ?? fetch
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  }

  /** @internal transporte — prefira os métodos/funções de operação (validam e parseiam). */
  async request(
    method: string,
    path: string,
    opts: {
      body?: unknown
      idempotencyKey?: string
      extraHeaders?: Record<string, string>
    } = {}
  ): Promise<unknown> {
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.options.accessToken}`,
        "Content-Type": "application/json",
        ...(opts.idempotencyKey
          ? { "X-Idempotency-Key": opts.idempotencyKey }
          : {}),
        ...opts.extraHeaders,
      },
      signal: AbortSignal.timeout(this.timeoutMs),
      ...(opts.body === undefined ? {} : { body: JSON.stringify(opts.body) }),
    })
    return parseMpResponse(response, method, path)
  }

  async createPointOrder(
    input: CreatePointOrderInput,
    idempotencyKey: string
  ): Promise<MpOrder> {
    assertAmount(input.amount)
    assertExternalReference(input.externalReference)
    assertTerminalId(input.terminalId)
    if (input.description !== undefined) assertDescription(input.description)
    if (input.expirationTime !== undefined)
      assertExpirationTime(input.expirationTime)
    return parseOrder(
      await this.request("POST", "/v1/orders", {
        body: buildCreateOrderBody(input),
        idempotencyKey,
      })
    )
  }

  async getOrder(orderId: string): Promise<MpOrder> {
    return parseOrder(
      await this.request("GET", `/v1/orders/${encodeURIComponent(orderId)}`)
    )
  }
}
