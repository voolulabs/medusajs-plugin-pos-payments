import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { GET as listStores, POST as createStoreRoute } from "../stores/route"
import { GET as listPos, POST as createPosRoute } from "../stores/pos/route"
import { GET as listRoute } from "../connections/route"
import { POST as startRoute } from "../connections/[acquirer]/start/route"
import { POST as testRoute } from "../connections/[acquirer]/test/route"
import { POST as selectRoute } from "../terminals/[id]/select/route"
import { GET as registersGet, POST as registersPost } from "../registers/route"
import { registersOf } from "../registers/route"
import { sendOnboardingError, merchantCredentials } from "../onboarding-context"
import { connectValidated } from "../../../../services/onboarding/connections"
import {
  getValidAccessToken,
  resetInflight,
} from "../../../../services/onboarding/refresh"
import { OnboardingError } from "../../../../services/onboarding/errors"
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
import { GET as callbackGet } from "../../../pos-payments/callback/[acquirer]/route"

describe("gaps de branches das rotas de onboarding", () => {
  let mod: ReturnType<typeof newModule>
  let scope: ReturnType<typeof fakeScope>
  let original: typeof fetch
  beforeEach(async () => {
    original = globalThis.fetch
    mod = newModule()
    withTestKey()
    withOnboardingEnv()
    scope = fakeScope({ module: mod })
    resetInflight()
  })
  afterEach(() => {
    globalThis.fetch = original
  })

  it("start/test com adquirente não suportado → 404; test degrada em 5xx do /users/me", async () => {
    const res = fakeRes()
    await startRoute(fakeReq({ acquirer: "stone" }, scope), res as never)
    expect(res.code).toBe(404)
    const { fetchImpl } = fakeFetch((call) =>
      call.url.endsWith("/oauth/token")
        ? { body: { access_token: "n", expires_in: 3600 } }
        : { status: 502, body: { error: "boom" } }
    )
    original = globalThis.fetch
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
    const degraded = fakeRes()
    await testRoute(
      fakeReq({ acquirer: "mercadopago" }, scope),
      degraded as never
    )
    expect(degraded.body).toEqual({ status: "degraded" })
    expect(mod.db.audits.map((a) => a.event)).toContain("connection.degraded")
  })

  it("select com corpo inválido; registers POST sem label; registersOf vazio", async () => {
    const invalid = fakeRes()
    await selectRoute(
      fakeReq({ id: "t1" }, scope, { body: { registerId: "não-uuid" } }),
      invalid as never
    )
    expect(invalid.code).toBe(400)
    const reg = fakeRes()
    await registersPost(
      fakeReq({}, scope, {
        body: { registerId: "11111111-1111-4111-8111-111111111111" },
      }),
      reg as never
    )
    expect(reg.code).toBe(200)
    expect(registersOf(undefined)).toEqual({})
    const listed = fakeRes()
    await registersGet(fakeReq({}, scope), listed as never)
    expect(listed.code).toBe(200)
  })
  it("connections GET lista conexões existentes; callback: adquirente estranho → error", async () => {
    mod.db.connections.push({
      acquirer: "mercadopago",
      status: "connected",
      actionReason: null,
      externalRefs: {},
      expiresAt: null,
      lastValidatedAt: null,
    })
    const listed = fakeRes()
    await listRoute(fakeReq({}, scope), listed as never)
    expect(
      (listed.body as { connections: unknown[] }).connections
    ).toHaveLength(1)
    const res = fakeRes()
    await callbackGet(
      fakeReq({ acquirer: "sumup" }, scope, { query: {} }),
      res as never
    )
    expect(res.redirected?.location).toContain("result=error")
  })
})
