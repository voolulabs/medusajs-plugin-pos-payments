/** Estados de ordem da Orders API do Mercado Pago (docs Point/Orders, 2026-08). */
export type MpOrderStatus =
  | "created"
  | "at_terminal"
  | "processed"
  | "canceled"
  | "expired"
  | "action_required"
  | "failed"
  | "refunded"

export interface MpOrderPayment {
  id: string
  amount: string
  status?: string
  status_detail?: string
}

/** Forma da ordem que o adapter consome (subset do contrato oficial). */
export interface MpOrder {
  id: string
  status: MpOrderStatus
  type?: string
  external_reference?: string
  description?: string
  transactions?: { payments?: MpOrderPayment[] }
}

/** Primeiro `code` string de um corpo envelopado {errors: [{code}]} —
 * undefined caso contrário (array vazio, code não-string, envelope não-array). */
function envelopedCode(body: object): string | undefined {
  const errors = (body as { errors?: unknown }).errors
  const first = Array.isArray(errors) ? errors[0] : undefined
  const code =
    first !== undefined && first !== null && typeof first === "object"
      ? (first as { code?: unknown }).code
      : undefined
  return typeof code === "string" ? code : undefined
}

export class MpApiError extends Error {
  /** Presente em 429 — segundos sugeridos pelo server para retry (ADR 0001). */
  readonly retryAfter?: string
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown,
    retryAfter?: string
  ) {
    super(message)
    this.name = "MpApiError"
    if (retryAfter !== undefined) this.retryAfter = retryAfter
  }

  /** Código do erro no corpo MP, quando presente — insumo do contrato por
   * estado da rota de cancelamento (cannot_cancel_order etc.). A Orders API
   * ENVELOPA em array ({errors: [{code: "..."}]}) — forma observada ao vivo
   * no sandbox (409 do cancel, 2026-10-07); a forma plana ({error: "..."})
   * segue aceita por defensividade. */
  get code(): string | undefined {
    if (typeof this.body !== "object" || this.body === null) return undefined
    const flat = (this.body as { error?: unknown }).error
    if (typeof flat === "string") return flat
    return envelopedCode(this.body)
  }
}

/** 409 idempotency_key_already_used — o wiring re-consulta o recurso, nunca recria. */
export class MpIdempotencyConflictError extends MpApiError {
  constructor(
    message: string,
    override readonly body: unknown
  ) {
    super(message, 409, body)
    this.name = "MpIdempotencyConflictError"
  }
}

/**
 * Colisões de idempotência RETRYABLE — os únicos dois erros que a doc oficial
 * da Orders API classifica como "Idempotency Error" com instrução de retry
 * (docs checkout-api-orders/payment-management/integration-errors, 2026-10-07):
 * 423 `resource_locked` ("chave temporariamente travada — aguarde e tente
 * novamente") e 500 `idempotency_validation_failed` ("retry the request").
 * Diferente do 409 (re-consulta), o chamador pode repetir a chamada original —
 * a classe expõe `retryable: true` e herda o `retryAfter`; o backoff em si é
 * decisão do chamador (poll degrada para pending; rotas devolvem 500 honesto).
 */
export class MpIdempotencyRetryableError extends MpApiError {
  readonly retryable = true
  constructor(
    message: string,
    status: number,
    body: unknown,
    retryAfter?: string
  ) {
    super(message, status, body, retryAfter)
    this.name = "MpIdempotencyRetryableError"
  }
}

/** Violação de contrato em fronteira do adapter (entrada local ou resposta fora do schema). */
export class MpContractError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "MpContractError"
  }
}

export interface CreatePointOrderInput {
  amount: string
  description?: string
  /** 1–64 chars [A-Za-z0-9-_], sem PII — echo do id do charge no Medusa. */
  externalReference: string
  terminalId: string
  /** ISO-8601 PT30S–PT3H; omitido = default do server (15 min). */
  expirationTime?: string
  printOnTerminal?: "seller_ticket" | "no_ticket"
  /** Restringe o meio no terminal — contrato oficial: debit_card | credit_card | qr. */
  paymentMethodDefaultType?: "debit_card" | "credit_card" | "qr"
}
