/** Mapeia a Response bruta: colisões de idempotência tipadas, não-2xx → MpApiError, 2xx → payload. */
import {
  MpApiError,
  MpIdempotencyConflictError,
  MpIdempotencyRetryableError,
} from "./types"

/** Pares (status, error) que a doc oficial da Orders API classifica como
 * "Idempotency Error" retentável (integration-errors, 2026-10-07). */
const RETRYABLE_IDEMPOTENCY: ReadonlyMap<number, string> = new Map([
  [423, "resource_locked"],
  [500, "idempotency_validation_failed"],
])

export async function parseMpResponse(
  response: Response,
  method: string,
  path: string
): Promise<unknown> {
  const parsed: unknown = await response.json().catch(() => ({}))
  if (response.status === 409 && isIdempotencyConflict(parsed)) {
    throw new MpIdempotencyConflictError(
      `Mercado Pago ${method} ${path}: idempotency_key_already_used`,
      parsed
    )
  }
  const retryableError = RETRYABLE_IDEMPOTENCY.get(response.status)
  if (retryableError !== undefined && matchesMpError(parsed, retryableError)) {
    throw new MpIdempotencyRetryableError(
      `Mercado Pago ${method} ${path}: ${retryableError}`,
      response.status,
      parsed,
      // Só 423/500 chegam aqui — o hint Retry-After é repassado quando presente.
      response.headers.get("Retry-After") ?? undefined
    )
  }
  if (!response.ok) {
    throw new MpApiError(
      `Mercado Pago ${method} ${path}: HTTP ${response.status}`,
      response.status,
      parsed,
      // ADR 0001: o helper respeita rate limit — 429 carrega o Retry-After.
      response.status === 429
        ? (response.headers.get("Retry-After") ?? undefined)
        : undefined
    )
  }
  return parsed
}

function matchesMpError(body: unknown, mpError: string): boolean {
  return (
    typeof body === "object" &&
    body !== null &&
    (body as { error?: unknown }).error === mpError
  )
}

function isIdempotencyConflict(body: unknown): boolean {
  return matchesMpError(body, "idempotency_key_already_used")
}
