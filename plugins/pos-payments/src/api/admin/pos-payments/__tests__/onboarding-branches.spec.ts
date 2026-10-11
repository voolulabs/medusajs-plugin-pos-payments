import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  POST as testRoute,
  podePromover,
} from "../connections/[acquirer]/test/route"
import {
  POST as pasteRoute,
  DELETE as deleteRoute,
} from "../connections/[acquirer]/route"
import { GET as listRoute } from "../connections/route"
import { connectValidated } from "../../../../services/onboarding/connections"
import {
  fakeFetch,
  withTestKey,
} from "../../../../services/onboarding/__tests__/helpers"
import {
  fakeReq,
  fakeRes,
  fakeScope,
  newModule,
  withOnboardingEnv,
} from "./helpers"

describe("branches do /test e do /connections", () => {
  let mod: ReturnType<typeof newModule>
  let scope: ReturnType<typeof fakeScope>
  let original: typeof fetch
  beforeEach(() => {
    mod = newModule()
    withTestKey()
    withOnboardingEnv()
    scope = fakeScope({ module: mod })
    original = globalThis.fetch
  })
  afterEach(() => {
    globalThis.fetch = original
  })

  it("podePromover: só connected/degraded/reauthorize", () => {
    expect(podePromover("connected", null)).toBe(true)
    expect(podePromover("degraded", null)).toBe(true)
    expect(podePromover("action_required", "reauthorize")).toBe(true)
    expect(podePromover("action_required", "pairing")).toBe(false)
    expect(podePromover("unconfigured", null)).toBe(false)
  })

  it("test com action_required:pairing valida mas NÃO promove (§4)", async () => {
    await connectValidated(mod.svc as never, {
      acquirer: "mercadopago",
      secret: {
        access_token: "tok",
        refresh_token: "rt",
        expires_at: new Date(Date.now() + 3600_000).toISOString(),
      },
      actorId: null,
      from: "unconfigured",
      validate: async () => ({ user_id: "9" }),
    })
    mod.db.connections[0]!.status = "action_required"
    mod.db.connections[0]!.actionReason = "pairing"
    const { fetchImpl } = fakeFetch(() => ({ body: { id: 9 } }))
    globalThis.fetch = fetchImpl
    const res = fakeRes()
    await testRoute(fakeReq({ acquirer: "mercadopago" }, scope), res as never)
    expect(res.body).toEqual({ status: "action_required" })
    expect(mod.db.connections[0]!.status).toBe("action_required")
    expect(mod.db.connections[0]!.actionReason).toBe("pairing")
  })

  it("test com falha reauthorize propaga 409 (refresh já marcou)", async () => {
    const { fetchImpl } = fakeFetch(() => ({
      status: 400,
      body: { error: "invalid_grant" },
    }))
    globalThis.fetch = fetchImpl
    await connectValidated(mod.svc as never, {
      acquirer: "mercadopago",
      secret: {
        access_token: "old",
        refresh_token: "rt",
        expires_at: new Date(Date.now() + 1000).toISOString(),
      },
      actorId: null,
      from: "unconfigured",
      validate: async () => ({ user_id: "5" }),
    })
    const res = fakeRes()
    await testRoute(fakeReq({ acquirer: "mercadopago" }, scope), res as never)
    expect(res.code).toBe(409)
  })

  it("POST corpo inválido → 400; DELETE de acquirer estranho → 404", async () => {
    const bad = fakeRes()
    await pasteRoute(
      fakeReq({ acquirer: "mercadopago" }, scope, { body: {} }),
      bad as never
    )
    expect(bad.code).toBe(400)
    const gone = fakeRes()
    await deleteRoute(fakeReq({ acquirer: "sumup" }, scope), gone as never)
    expect(gone.code).toBe(404)
  })

  it("GET connections lista o estado não-sensível", async () => {
    mod.db.connections.push({
      acquirer: "mercadopago",
      status: "connected",
      actionReason: null,
      externalRefs: { user_id: "7" },
      expiresAt: null,
      lastValidatedAt: null,
    })
    const listed = fakeRes()
    await listRoute(fakeReq({}, scope), listed as never)
    expect(listed.code).toBe(200)
    expect(
      (listed.body as { connections: unknown[] }).connections
    ).toHaveLength(1)
  })
})
