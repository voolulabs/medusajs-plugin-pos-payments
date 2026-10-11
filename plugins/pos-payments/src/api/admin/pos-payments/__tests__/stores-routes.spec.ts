import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { connectValidated } from "../../../../services/onboarding/connections"
import {
  fakeFetch,
  withTestKey,
} from "../../../../services/onboarding/__tests__/helpers"
import { GET as listStores, POST as createStoreRoute } from "../stores/route"
import { GET as listPos, POST as createPosRoute } from "../stores/pos/route"
import { DELETE as deletePosRoute } from "../stores/pos/[id]/route"
import {
  fakeReq,
  fakeRes,
  fakeScope,
  newModule,
  withOnboardingEnv,
} from "./helpers"

/** Respostas MP simuladas das rotas stores/pos (achatado p/ nesting ≤4). */
function posReply(
  method: string,
  url: string
): { status?: number; body: unknown } {
  if (url.startsWith("https://api.mercadopago.com/v2/pos/")) return { body: {} }
  if (method === "POST") return { status: 201, body: { id: 9 } }
  return { body: { results: [{ id: 7 }] } }
}

function storesReply(url: string): { status?: number; body: unknown } {
  if (url === "https://api.mercadopago.com/users/42/stores")
    return { body: { id: 1, name: "Loja" } }
  return { body: { results: [{ id: 1, external_id: "unidade-1" }] } }
}

function storesResponder(call: { method: string; url: string }): {
  status?: number
  body: unknown
} {
  if (call.url.endsWith("/users/me")) return { body: { id: 42 } }
  if (call.url.includes("/users/42/stores/search")) return storesReply(call.url)
  if (call.url.includes("/v2/pos")) return posReply(call.method, call.url)
  return { body: {} }
}

describe("rotas stores/pos (AC8)", () => {
  let mod: ReturnType<typeof newModule>
  let scope: ReturnType<typeof fakeScope>
  let original: typeof fetch
  beforeEach(async () => {
    mod = newModule()
    withTestKey()
    withOnboardingEnv()
    scope = fakeScope({ module: mod })
    const { fetchImpl } = fakeFetch(storesResponder)
    original = globalThis.fetch
    globalThis.fetch = fetchImpl
    await connectValidated(mod.svc as never, {
      acquirer: "mercadopago",
      secret: {
        access_token: "tok",
        refresh_token: "rt",
        expires_at: new Date(Date.now() + 3600_000).toISOString(),
      },
      actorId: "admin-1",
      from: "unconfigured",
      validate: async () => ({ user_id: "42" }),
    })
  })

  it("GET stores e POST store com token do lojista", async () => {
    const listed = fakeRes()
    await listStores(
      fakeReq({}, scope, { query: { external_id: "unidade-1" } }),
      listed as never
    )
    expect(listed.code).toBe(200)
    expect((listed.body as { stores: unknown[] }).stores).toHaveLength(1)
    const created = fakeRes()
    await createStoreRoute(
      fakeReq({}, scope, {
        body: { name: "Loja Centro", externalId: "unidade-2" },
      }),
      created as never
    )
    expect(created.code).toBe(201)
  })

  it("GET/POST pos: idempotency key determinística; corpo sem loja → 400", async () => {
    const listed = fakeRes()
    await listPos(
      fakeReq({}, scope, { query: { external_id: "stock-1" } }),
      listed as never
    )
    expect((listed.body as { pos: unknown[] }).pos).toHaveLength(1)
    const created = fakeRes()
    await createPosRoute(
      fakeReq({}, scope, {
        body: { externalId: "stock-1", externalStoreId: "unidade-1" },
      }),
      created as never
    )
    expect(created.code).toBe(201)
    const invalid = fakeRes()
    await createPosRoute(
      fakeReq({}, scope, { body: { externalId: "stock-2" } }),
      invalid as never
    )
    expect(invalid.code).toBe(400)
  })

  it("DELETE pos/:id responde 200; sem conexão ativa → 409 tipado", async () => {
    const res = fakeRes()
    await deletePosRoute(fakeReq({ id: "9" }, scope), res as never)
    expect(res.code).toBe(200)
    mod.db.credentials = []
    const denied = fakeRes()
    await deletePosRoute(fakeReq({ id: "9" }, scope), denied as never)
    expect(denied.code).toBe(409)
  })

  afterEach(() => {
    globalThis.fetch = original
  })
})
