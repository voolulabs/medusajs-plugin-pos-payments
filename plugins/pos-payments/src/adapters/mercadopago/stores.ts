/** Stores/POS CRUD (mercado-pago.md §10.1 — OpenAPI pos/spec3.yaml): binding
 * MP ↔ Medusa por external_id (store = unidade, POS = stock location).
 * Credencial: token do LOJISTA (header Authorization por chamada). */
import { OnboardingError } from "../../services/onboarding/errors"
import type { OnboardingHttpClient } from "./onboarding-client"

interface MpStore {
  id: unknown
  name?: unknown
  external_id?: unknown
}

interface MpPos {
  id: unknown
  name?: unknown
  status?: unknown
  external_id?: unknown
  store_id?: unknown
  external_store_id?: unknown
}

function auth(merchantToken: string): Record<string, string> {
  return { Authorization: `Bearer ${merchantToken}` }
}

/** POST /users/{user_id}/stores — external_id = id da unidade no Medusa. */
export async function createStore(
  http: OnboardingHttpClient,
  merchantToken: string,
  userId: string,
  input: {
    name: string
    externalId: string
    location?: Record<string, unknown>
    businessHours?: Record<string, unknown>
  }
): Promise<MpStore> {
  const { body } = await http.request(
    "POST",
    `/users/${encodeURIComponent(userId)}/stores`,
    {
      headers: auth(merchantToken),
      json: {
        name: input.name,
        external_id: input.externalId,
        ...(input.location ? { location: input.location } : {}),
        ...(input.businessHours ? { business_hours: input.businessHours } : {}),
      },
    }
  )
  return body as MpStore
}

/** GET /users/{user_id}/stores/search — re-sincroniza lojas (external_id). */
export async function searchStores(
  http: OnboardingHttpClient,
  merchantToken: string,
  userId: string,
  filters: { externalId?: string } = {}
): Promise<MpStore[]> {
  const qs = new URLSearchParams()
  if (filters.externalId) qs.set("external_id", filters.externalId)
  const suffix = qs.size ? `?${qs.toString()}` : ""
  const { body } = await http.request(
    "GET",
    `/users/${encodeURIComponent(userId)}/stores/search${suffix}`,
    { headers: auth(merchantToken) }
  )
  return Array.isArray((body as { results?: MpStore[] })?.results)
    ? (body as { results: MpStore[] }).results
    : []
}

/** GET /v2/pos — lookup do vínculo: ?external_id={stockLocationId}. */
export async function listPos(
  http: OnboardingHttpClient,
  merchantToken: string,
  filters: {
    externalId?: string
    storeId?: string
    externalStoreId?: string
  } = {}
): Promise<MpPos[]> {
  const qs = new URLSearchParams()
  if (filters.externalId) qs.set("external_id", filters.externalId)
  if (filters.storeId) qs.set("store_id", filters.storeId)
  if (filters.externalStoreId)
    qs.set("external_store_id", filters.externalStoreId)
  const suffix = qs.size ? `?${qs.toString()}` : ""
  const { body } = await http.request("GET", `/v2/pos${suffix}`, {
    headers: auth(merchantToken),
  })
  const results = (body as { results?: MpPos[] })?.results
  return Array.isArray(results)
    ? results
    : Array.isArray(body)
      ? (body as MpPos[])
      : []
}

/** POST /v2/pos — X-Idempotency-Key OBRIGATÓRIO (1–64 chars, spec §10.1). */
export async function createPos(
  http: OnboardingHttpClient,
  merchantToken: string,
  input: {
    name?: string
    externalId: string
    storeId?: string
    externalStoreId?: string
  },
  idempotencyKey: string
): Promise<MpPos> {
  if (!/^[0-9a-fA-F-]{8,64}$/.test(idempotencyKey)) {
    throw new OnboardingError(
      "invalid_credential",
      400,
      "idempotency key inválida"
    )
  }
  if (!input.storeId && !input.externalStoreId) {
    throw new OnboardingError(
      "invalid_credential",
      400,
      "store_id ou external_store_id obrigatório"
    )
  }
  const { body } = await http.request("POST", "/v2/pos", {
    headers: { ...auth(merchantToken), "X-Idempotency-Key": idempotencyKey },
    json: {
      ...(input.name ? { name: input.name } : {}),
      external_id: input.externalId,
      ...(input.storeId ? { store_id: input.storeId } : {}),
      ...(input.externalStoreId
        ? { external_store_id: input.externalStoreId }
        : {}),
    },
  })
  return body as MpPos
}

/** DELETE /v2/pos/{id} — desligamento do vínculo. */
export async function deletePos(
  http: OnboardingHttpClient,
  merchantToken: string,
  posId: string
): Promise<void> {
  await http.request("DELETE", `/v2/pos/${encodeURIComponent(posId)}`, {
    headers: auth(merchantToken),
  })
}
